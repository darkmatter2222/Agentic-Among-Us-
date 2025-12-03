"""
Fine-tuning Llama 3.2 1B for Among Us AI Agents

This script fine-tunes a Llama 3.2 1B model using QLoRA to reduce
refusals and teach it that Among Us game prompts are safe.

Optimized for RTX 5090 with 32GB VRAM.

Usage:
    python train.py --model_path /path/to/llama-3.2-1b-instruct.gguf
    
    Or if you want to use HuggingFace:
    python train.py --model_id meta-llama/Llama-3.2-1B-Instruct
"""

import argparse
import os
import json
from pathlib import Path
from datetime import datetime

import torch
from datasets import load_dataset, Dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    TrainingArguments,
    DataCollatorForLanguageModeling,
    EarlyStoppingCallback,
)
from peft import (
    LoraConfig,
    get_peft_model,
    prepare_model_for_kbit_training,
    TaskType,
)
from trl import SFTTrainer, SFTConfig

# Try to import wandb for experiment tracking (optional)
try:
    import wandb
    WANDB_AVAILABLE = True
except ImportError:
    WANDB_AVAILABLE = False


def parse_args():
    parser = argparse.ArgumentParser(description="Fine-tune Llama 3.2 1B for Among Us")
    
    # Model arguments
    parser.add_argument(
        "--model_id",
        type=str,
        default="meta-llama/Llama-3.2-1B-Instruct",
        help="HuggingFace model ID or local path to the model"
    )
    parser.add_argument(
        "--output_dir",
        type=str,
        default="./output",
        help="Directory to save the fine-tuned model"
    )
    
    # Training arguments - optimized for RTX 5090 with 34GB VRAM
    parser.add_argument("--epochs", type=int, default=1, help="Number of training epochs")
    parser.add_argument("--batch_size", type=int, default=16, help="Batch size per device (16 with 4-bit quant)")
    parser.add_argument("--gradient_accumulation", type=int, default=2, help="Gradient accumulation steps (effective batch = batch_size * grad_accum)")
    parser.add_argument("--learning_rate", type=float, default=2e-4, help="Learning rate")
    parser.add_argument("--max_seq_length", type=int, default=512, help="Maximum sequence length (shorter = faster)")
    parser.add_argument("--warmup_ratio", type=float, default=0.03, help="Warmup ratio")
    parser.add_argument("--max_samples", type=int, default=None, help="Max training samples (None = use all). Try 20000-50000 for faster training.")
    parser.add_argument("--early_stopping_patience", type=int, default=3, help="Early stopping patience (evaluations without improvement)")
    parser.add_argument("--no_gradient_checkpointing", action="store_true", default=True, help="Disable gradient checkpointing (faster, uses more VRAM)")
    
    # LoRA arguments
    parser.add_argument("--lora_r", type=int, default=64, help="LoRA rank")
    parser.add_argument("--lora_alpha", type=int, default=128, help="LoRA alpha")
    parser.add_argument("--lora_dropout", type=float, default=0.05, help="LoRA dropout")
    
    # Other arguments
    parser.add_argument("--use_4bit", action="store_true", default=True, help="Use 4-bit quantization (much less VRAM, required for larger batches)")
    parser.add_argument("--use_wandb", action="store_true", help="Use Weights & Biases for logging")
    parser.add_argument("--wandb_project", type=str, default="among-us-llama", help="W&B project name")
    
    return parser.parse_args()


def load_and_prepare_data(data_dir: Path):
    """Load the prepared training data."""
    train_path = data_dir / "train.jsonl"
    val_path = data_dir / "val.jsonl"
    
    if not train_path.exists():
        raise FileNotFoundError(
            f"Training data not found at {train_path}. "
            "Run prepare_dataset.py first!"
        )
    
    # Load datasets
    train_dataset = load_dataset('json', data_files=str(train_path), split='train')
    
    if val_path.exists():
        val_dataset = load_dataset('json', data_files=str(val_path), split='train')
    else:
        # Create a small validation split
        split = train_dataset.train_test_split(test_size=0.1, seed=42)
        train_dataset = split['train']
        val_dataset = split['test']
    
    print(f"Training samples: {len(train_dataset)}")
    print(f"Validation samples: {len(val_dataset)}")
    
    return train_dataset, val_dataset


def format_chat_template(example, tokenizer):
    """
    Format the example using the tokenizer's chat template.
    """
    messages = example.get('messages', [])
    if not messages:
        return {'text': ''}
    
    # Use the tokenizer's apply_chat_template if available
    try:
        text = tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=False
        )
    except Exception:
        # Fallback to manual formatting
        text = ""
        for msg in messages:
            role = msg['role']
            content = msg['content']
            if role == 'system':
                text += f"<|start_header_id|>system<|end_header_id|>\n\n{content}<|eot_id|>"
            elif role == 'user':
                text += f"<|start_header_id|>user<|end_header_id|>\n\n{content}<|eot_id|>"
            elif role == 'assistant':
                text += f"<|start_header_id|>assistant<|end_header_id|>\n\n{content}<|eot_id|>"
    
    return {'text': text}


def main():
    args = parse_args()
    
    print("=" * 60)
    print("Fine-tuning Llama 3.2 1B for Among Us AI Agents")
    print("=" * 60)
    
    # Check CUDA
    if not torch.cuda.is_available():
        print("WARNING: CUDA not available! Training will be very slow.")
    else:
        print(f"CUDA Device: {torch.cuda.get_device_name(0)}")
        print(f"CUDA Memory: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")
    
    # Setup paths
    script_dir = Path(__file__).parent
    data_dir = script_dir / "data"
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Initialize W&B if requested
    if args.use_wandb and WANDB_AVAILABLE:
        wandb.init(
            project=args.wandb_project,
            name=f"llama-finetune-{datetime.now().strftime('%Y%m%d_%H%M%S')}",
            config=vars(args)
        )
    
    # Load data
    print("\n--- Loading Data ---")
    train_dataset, val_dataset = load_and_prepare_data(data_dir)

    # Optionally limit dataset size for faster training
    if args.max_samples and len(train_dataset) > args.max_samples:
        print(f"Limiting training samples from {len(train_dataset)} to {args.max_samples}")
        train_dataset = train_dataset.shuffle(seed=42).select(range(args.max_samples))
        # Also reduce validation proportionally
        val_samples = min(len(val_dataset), args.max_samples // 10)
        val_dataset = val_dataset.shuffle(seed=42).select(range(val_samples))
        print(f"Training samples (after limit): {len(train_dataset)}")
        print(f"Validation samples (after limit): {len(val_dataset)}")
    
    # Setup quantization for memory efficiency
    print("\n--- Setting up Model ---")
    
    if args.use_4bit:
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_use_double_quant=True,
        )
    else:
        bnb_config = None
    
    # Load tokenizer
    print(f"Loading tokenizer from {args.model_id}...")
    tokenizer = AutoTokenizer.from_pretrained(
        args.model_id,
        trust_remote_code=True,
        use_fast=True
    )
    
    # Set padding token if not set
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
        tokenizer.pad_token_id = tokenizer.eos_token_id
    
    tokenizer.padding_side = "right"
    
    # Load model
    print(f"Loading model from {args.model_id}...")
    model = AutoModelForCausalLM.from_pretrained(
        args.model_id,
        quantization_config=bnb_config,
        device_map="auto",
        trust_remote_code=True,
        torch_dtype=torch.bfloat16,
        attn_implementation="sdpa",  # PyTorch's SDPA (flash-attn not available on Windows)
    )
    
    # Prepare model for k-bit training
    if args.use_4bit:
        model = prepare_model_for_kbit_training(model)
    
    # Setup LoRA
    print("\n--- Configuring LoRA ---")
    lora_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        bias="none",
        task_type=TaskType.CAUSAL_LM,
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj"
        ],
    )
    
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()
    
    # Format datasets
    print("\n--- Formatting Data ---")
    train_dataset = train_dataset.map(
        lambda x: format_chat_template(x, tokenizer),
        remove_columns=train_dataset.column_names
    )
    val_dataset = val_dataset.map(
        lambda x: format_chat_template(x, tokenizer),
        remove_columns=val_dataset.column_names
    )
    
    # Training arguments
    print("\n--- Setting up Training ---")

    # Calculate appropriate eval/save steps based on dataset size
    effective_batch_size = args.batch_size * args.gradient_accumulation
    steps_per_epoch = len(train_dataset) // effective_batch_size
    # Evaluate ~10 times per epoch, save ~5 times per epoch
    eval_steps = max(100, steps_per_epoch // 10)
    save_steps = max(200, steps_per_epoch // 5)
    
    print(f"Dataset size: {len(train_dataset)}")
    print(f"Effective batch size: {effective_batch_size}")
    print(f"Steps per epoch: ~{steps_per_epoch}")
    print(f"Eval every {eval_steps} steps, Save every {save_steps} steps")

    # Gradient checkpointing: saves VRAM but ~30% slower
    use_grad_ckpt = not args.no_gradient_checkpointing
    print(f"Gradient checkpointing: {'ON (slower, less VRAM)' if use_grad_ckpt else 'OFF (faster, more VRAM)'}")

    training_args = SFTConfig(
        output_dir=str(output_dir),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        gradient_accumulation_steps=args.gradient_accumulation,
        gradient_checkpointing=use_grad_ckpt,
        gradient_checkpointing_kwargs={"use_reentrant": False} if use_grad_ckpt else None,
        learning_rate=args.learning_rate,
        lr_scheduler_type="cosine",
        warmup_ratio=args.warmup_ratio,
        weight_decay=0.01,
        optim="adamw_torch_fused",  # Fused optimizer is faster than paged_adamw_8bit
        bf16=True,
        tf32=True,
        max_grad_norm=0.3,
        logging_steps=50,
        eval_strategy="steps",
        eval_steps=eval_steps,
        save_strategy="steps",
        save_steps=save_steps,
        save_total_limit=3,
        max_length=args.max_seq_length,
        packing=False,  # Disabled - requires flash-attn for safe use
        dataset_text_field="text",
        report_to="wandb" if (args.use_wandb and WANDB_AVAILABLE) else "none",
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        dataloader_num_workers=4,  # Parallel data loading
        dataloader_pin_memory=True,
    )    # Create trainer - TRL 0.25+ uses processing_class instead of tokenizer
    # Add early stopping callback
    callbacks = []
    if args.early_stopping_patience > 0:
        callbacks.append(EarlyStoppingCallback(early_stopping_patience=args.early_stopping_patience))
        print(f"Early stopping enabled: patience={args.early_stopping_patience} evaluations")

    trainer = SFTTrainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        processing_class=tokenizer,
        callbacks=callbacks,
    )

    # Train!
    print("\n" + "=" * 60)
    print("Starting Training...")
    print("=" * 60)
    
    trainer.train()
    
    # Save the final model
    print("\n--- Saving Model ---")
    final_output_dir = output_dir / "final"
    final_output_dir.mkdir(exist_ok=True)
    
    # Save LoRA adapter
    model.save_pretrained(str(final_output_dir))
    tokenizer.save_pretrained(str(final_output_dir))
    
    print(f"\n✓ Model saved to {final_output_dir}")
    
    # Save training config
    config_path = final_output_dir / "training_config.json"
    with open(config_path, 'w') as f:
        json.dump(vars(args), f, indent=2)
    
    print(f"✓ Config saved to {config_path}")
    
    if args.use_wandb and WANDB_AVAILABLE:
        wandb.finish()
    
    print("\n" + "=" * 60)
    print("Training Complete!")
    print("=" * 60)
    print(f"\nNext steps:")
    print(f"1. Merge LoRA adapter: python merge_model.py --adapter_path {final_output_dir}")
    print(f"2. Convert to GGUF: python convert_to_gguf.py --model_path ./merged_model")
    print(f"3. Deploy the model with llama.cpp")


if __name__ == "__main__":
    main()
