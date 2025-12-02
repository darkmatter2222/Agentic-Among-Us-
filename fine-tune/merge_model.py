"""
Merge LoRA Adapter with Base Model

After fine-tuning, this script merges the LoRA adapter weights
back into the base model for deployment.

Usage:
    python merge_model.py --adapter_path ./output/final
"""

import argparse
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel


def parse_args():
    parser = argparse.ArgumentParser(description="Merge LoRA adapter with base model")
    parser.add_argument(
        "--base_model_id",
        type=str,
        default="meta-llama/Llama-3.2-1B-Instruct",
        help="Base model ID or path"
    )
    parser.add_argument(
        "--adapter_path",
        type=str,
        required=True,
        help="Path to the LoRA adapter"
    )
    parser.add_argument(
        "--output_dir",
        type=str,
        default="./merged_model",
        help="Output directory for merged model"
    )
    parser.add_argument(
        "--push_to_hub",
        action="store_true",
        help="Push the merged model to HuggingFace Hub"
    )
    parser.add_argument(
        "--hub_repo_id",
        type=str,
        default=None,
        help="HuggingFace Hub repository ID"
    )
    return parser.parse_args()


def main():
    args = parse_args()
    
    print("=" * 60)
    print("Merging LoRA Adapter with Base Model")
    print("=" * 60)
    
    adapter_path = Path(args.adapter_path)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Load tokenizer
    print(f"\nLoading tokenizer from {args.base_model_id}...")
    tokenizer = AutoTokenizer.from_pretrained(
        args.base_model_id,
        trust_remote_code=True
    )
    
    # Load base model in fp16 for merging
    print(f"Loading base model from {args.base_model_id}...")
    base_model = AutoModelForCausalLM.from_pretrained(
        args.base_model_id,
        torch_dtype=torch.float16,
        device_map="auto",
        trust_remote_code=True,
    )
    
    # Load LoRA adapter
    print(f"Loading LoRA adapter from {adapter_path}...")
    model = PeftModel.from_pretrained(base_model, str(adapter_path))
    
    # Merge LoRA weights with base model
    print("Merging weights...")
    model = model.merge_and_unload()
    
    # Save merged model
    print(f"Saving merged model to {output_dir}...")
    model.save_pretrained(str(output_dir))
    tokenizer.save_pretrained(str(output_dir))
    
    print(f"\n✓ Merged model saved to {output_dir}")
    
    # Optionally push to Hub
    if args.push_to_hub and args.hub_repo_id:
        print(f"\nPushing to HuggingFace Hub: {args.hub_repo_id}...")
        model.push_to_hub(args.hub_repo_id)
        tokenizer.push_to_hub(args.hub_repo_id)
        print(f"✓ Pushed to {args.hub_repo_id}")
    
    print("\n" + "=" * 60)
    print("Merge Complete!")
    print("=" * 60)
    print(f"\nNext step: Convert to GGUF for llama.cpp deployment")
    print(f"  python convert_to_gguf.py --model_path {output_dir}")


if __name__ == "__main__":
    main()
