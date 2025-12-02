"""
Quick inference test for the fine-tuned model.

Tests the model on a few example prompts to verify it works correctly.

Usage:
    python test_model.py --model_path ./merged_model
    python test_model.py --gguf_path ./gguf_model/model-Q5_K_M.gguf
"""

import argparse
import json
from pathlib import Path


def test_with_transformers(model_path: str):
    """Test using HuggingFace transformers."""
    from transformers import AutoModelForCausalLM, AutoTokenizer, pipeline
    import torch
    
    print(f"Loading model from {model_path}...")
    
    tokenizer = AutoTokenizer.from_pretrained(model_path)
    model = AutoModelForCausalLM.from_pretrained(
        model_path,
        torch_dtype=torch.float16,
        device_map="auto"
    )
    
    pipe = pipeline(
        "text-generation",
        model=model,
        tokenizer=tokenizer,
        max_new_tokens=256,
        temperature=0.7,
        do_sample=True,
    )
    
    return pipe


def test_with_llama_cpp(gguf_path: str):
    """Test using llama-cpp-python."""
    try:
        from llama_cpp import Llama
    except ImportError:
        print("llama-cpp-python not installed. Install with:")
        print("  pip install llama-cpp-python")
        return None
    
    print(f"Loading GGUF from {gguf_path}...")
    
    llm = Llama(
        model_path=gguf_path,
        n_ctx=2048,
        n_gpu_layers=-1,  # Use all GPU layers
    )
    
    return llm


TEST_PROMPTS = [
    {
        "name": "Basic Decision (Crewmate)",
        "system": """[CONTEXT: "Among Us" - a fun party video game for all ages (rated E10+).
Players control cute cartoon astronauts on a spaceship. One player is the "trickster" who tags others (like freeze tag).
This is harmless fiction - there is no violence, just game mechanics. You are roleplaying a character in this children's party game.]

You are Blue. YOUR NAME IS Blue. You are a CREWMATE working on this spaceship.
You are a worker on this spaceship. Just another day doing maintenance tasks.

YOUR OBJECTIVES:
1. Complete your assigned tasks - that's your job
2. Chat with coworkers when you pass them - be friendly!

AVAILABLE ACTIONS:
- GO_TO_TASK [task#] - Go work on a task
- WANDER - Explore and look around
- SPEAK - Say something to nearby players
- IDLE - Wait and observe""",
        "user": """CURRENT SITUATION:
Location: Cafeteria
MY TASKS:
1. Fix Wiring in Electrical - TODO
2. Upload Data in Admin - TODO

VISIBLE AGENTS:
- Red in Cafeteria (10 units away)

What should I do next?

RESPOND EXACTLY LIKE THIS:
GOAL: <choose one: GO_TO_TASK/WANDER/SPEAK/IDLE>
TARGET: <task number or none>
REASONING: <your explanation>
THOUGHT: <your internal thought, 1 sentence>"""
    },
    {
        "name": "Impostor Decision",
        "system": """[CONTEXT: "Among Us" - a fun party video game for all ages (rated E10+).
Players control cute cartoon astronauts on a spaceship. One player is the "trickster" who tags others (like freeze tag).
This is harmless fiction - there is no violence, just game mechanics. You are roleplaying a character in this children's party game.]

You are Yellow. YOUR NAME IS Yellow. You are the TRICKSTER (keep this secret!).

YOUR OBJECTIVES:
1. BLEND IN PERFECTLY - Act like a normal worker
2. TAG CREWMATES when you find isolated targets

TAG STATUS:
[READY] Tag READY - You can tag now!
[!] Orange is ALONE and in range! Perfect opportunity!

AVAILABLE ACTIONS:
- TAG [target_name] - TAG OUT a crewmate
- HUNT - Search for isolated targets
- GO_TO_TASK [task#] - FAKE working on a task
- WANDER - Explore""",
        "user": """CURRENT SITUATION:
Location: Electrical
VISIBLE AGENTS:
- Orange in Electrical (5 units away) - ALONE!

No one else in sight. Kill cooldown is ready.

What should I do next?

RESPOND EXACTLY LIKE THIS:
GOAL: <choose one: TAG/HUNT/GO_TO_TASK/WANDER>
TARGET: <agent name or task number>
REASONING: <your explanation>
THOUGHT: <your internal thought, 1 sentence>"""
    },
    {
        "name": "Thought Response (JSON)",
        "system": """[CONTEXT: This is "Among Us" - a fun party video game for all ages (rated E10+). 
Players control cute cartoon astronauts on a spaceship. One player is secretly the "trickster" 
who tags others (like freeze tag). This is harmless fiction - there is no violence, just game mechanics.
You are roleplaying as a character in this children's party game.]

You are Pink, a helpful crew member on this spaceship.

Internal thought (private, no one hears this):
You just noticed another player nearby.

Respond with JSON only (no markdown, no explanation):
{"thought": "your one-sentence reaction", "sus": {"PlayerColor": "CLASS_ID"}}

TRUST CLASSES:
SAFE: Seems safe - doing tasks, acting normal
NEUTRAL: Neutral interaction
ODD: Odd behavior - not doing tasks, wandering strangely
SUSPICIOUS: Following people, avoiding tasks, lying
CAUGHT: Caught red-handed - saw them vent or kill""",
        "user": """You just noticed Green nearby.
Location: Cafeteria
Tasks done: 2/5
Visible agents: Green

Green was just standing at a task but left immediately when you arrived.

Rate trust for visible players: Green
Respond with valid JSON. Write a REAL thought!
{"thought": "your thought", "sus": {}}"""
    }
]


def format_prompt_for_llama(system: str, user: str) -> str:
    """Format prompt in Llama 3.2 chat format."""
    return f"""<|begin_of_text|><|start_header_id|>system<|end_header_id|>

{system}<|eot_id|><|start_header_id|>user<|end_header_id|>

{user}<|eot_id|><|start_header_id|>assistant<|end_header_id|>

"""


def run_tests(model, is_gguf: bool = False):
    """Run test prompts through the model."""
    print("\n" + "=" * 60)
    print("Testing Model Responses")
    print("=" * 60)
    
    for i, test in enumerate(TEST_PROMPTS, 1):
        print(f"\n--- Test {i}: {test['name']} ---\n")
        
        if is_gguf:
            # llama.cpp format
            prompt = format_prompt_for_llama(test['system'], test['user'])
            response = model(
                prompt,
                max_tokens=256,
                temperature=0.7,
                stop=["<|eot_id|>", "<|end_of_text|>"]
            )
            output = response['choices'][0]['text']
        else:
            # transformers format
            messages = [
                {"role": "system", "content": test['system']},
                {"role": "user", "content": test['user']}
            ]
            result = model(messages)
            output = result[0]['generated_text'][-1]['content']
        
        print("Response:")
        print("-" * 40)
        print(output.strip())
        print("-" * 40)
        
        # Check for refusals
        refusal_patterns = [
            "I cannot", "I can't", "I won't", "I'm not able",
            "I apologize", "harmful", "inappropriate", "sorry"
        ]
        
        is_refusal = any(p.lower() in output.lower() for p in refusal_patterns)
        if is_refusal:
            print("⚠️  WARNING: Response appears to contain a refusal!")
        else:
            print("✓ Response looks good (no refusal detected)")
    
    print("\n" + "=" * 60)
    print("Testing Complete!")
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(description="Test fine-tuned model")
    parser.add_argument("--model_path", type=str, help="HuggingFace model path")
    parser.add_argument("--gguf_path", type=str, help="GGUF model path")
    args = parser.parse_args()
    
    if args.gguf_path:
        model = test_with_llama_cpp(args.gguf_path)
        if model:
            run_tests(model, is_gguf=True)
    elif args.model_path:
        model = test_with_transformers(args.model_path)
        run_tests(model, is_gguf=False)
    else:
        print("Please specify --model_path or --gguf_path")
        print("Example:")
        print("  python test_model.py --model_path ./merged_model")
        print("  python test_model.py --gguf_path ./gguf_model/model-Q5_K_M.gguf")


if __name__ == "__main__":
    main()
