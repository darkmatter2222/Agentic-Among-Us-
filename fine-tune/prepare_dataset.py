"""
Dataset Preparation Script for Fine-tuning Llama 3.2 1B

This script reads the successful training data from LLM-training-data/success/
and converts it to the format required for fine-tuning with Llama 3.2.

The goal is to teach the model that these Among Us game prompts are safe
and should be responded to without refusals.
"""

import json
import os
from pathlib import Path
from typing import List, Dict, Any
import random


def load_training_data(success_dir: Path) -> List[Dict[str, Any]]:
    """Load all training data from the success directory."""
    all_entries = []
    
    for json_file in sorted(success_dir.glob("training-data-*.json")):
        print(f"Loading {json_file.name}...")
        try:
            with open(json_file, 'r', encoding='utf-8') as f:
                content = f.read().strip()
                # Handle files that might have multiple JSON objects
                # The file appears to be newline-delimited JSON or concatenated
                if content.startswith('['):
                    # It's a JSON array
                    data = json.loads(content)
                    if isinstance(data, list):
                        all_entries.extend(data)
                    else:
                        all_entries.append(data)
                else:
                    # Try to parse as concatenated JSON objects
                    # Split by '},\s*{' pattern
                    import re
                    # First, try loading the whole file
                    try:
                        data = json.loads(content)
                        if isinstance(data, list):
                            all_entries.extend(data)
                        else:
                            all_entries.append(data)
                    except json.JSONDecodeError:
                        # Try extracting individual JSON objects
                        objects = extract_json_objects(content)
                        all_entries.extend(objects)
        except Exception as e:
            print(f"  Error loading {json_file.name}: {e}")
            continue
    
    return all_entries


def extract_json_objects(content: str) -> List[Dict[str, Any]]:
    """Extract individual JSON objects from a string that might have multiple."""
    objects = []
    depth = 0
    start = None
    
    for i, char in enumerate(content):
        if char == '{':
            if depth == 0:
                start = i
            depth += 1
        elif char == '}':
            depth -= 1
            if depth == 0 and start is not None:
                try:
                    obj_str = content[start:i+1]
                    obj = json.loads(obj_str)
                    objects.append(obj)
                except json.JSONDecodeError:
                    pass
                start = None
    
    return objects


def format_for_llama_chat(entry: Dict[str, Any]) -> Dict[str, str]:
    """
    Format a training entry for Llama 3.2 chat format.
    
    Llama 3.2 uses the following format:
    <|begin_of_text|><|start_header_id|>system<|end_header_id|>
    {system_message}<|eot_id|><|start_header_id|>user<|end_header_id|>
    {user_message}<|eot_id|><|start_header_id|>assistant<|end_header_id|>
    {assistant_response}<|eot_id|>
    """
    system_prompt = entry.get('systemPrompt', '')
    user_prompt = entry.get('userPrompt', '')
    response = entry.get('rawResponse', '')
    
    if not system_prompt or not user_prompt or not response:
        return None
    
    # Clean up the prompts - remove any existing special tokens
    system_prompt = clean_text(system_prompt)
    user_prompt = clean_text(user_prompt)
    response = clean_text(response)
    
    return {
        'system': system_prompt,
        'user': user_prompt,
        'assistant': response,
        'request_type': entry.get('requestType', 'unknown'),
        'agent_role': entry.get('agentRole', 'unknown')
    }


def clean_text(text: str) -> str:
    """Clean text by removing problematic characters."""
    if not text:
        return ""
    # Remove any null bytes or other problematic characters
    text = text.replace('\x00', '')
    # Normalize whitespace but preserve structure
    lines = text.split('\n')
    cleaned_lines = [' '.join(line.split()) if line.strip() else '' for line in lines]
    return '\n'.join(cleaned_lines)


def create_llama_format_text(entry: Dict[str, str]) -> str:
    """
    Create the full Llama 3.2 chat format string.
    
    This is the exact format Llama 3.2 expects for fine-tuning.
    """
    template = """<|begin_of_text|><|start_header_id|>system<|end_header_id|>

{system}<|eot_id|><|start_header_id|>user<|end_header_id|}

{user}<|eot_id|><|start_header_id|>assistant<|end_header_id|>

{assistant}<|eot_id|>"""
    
    return ('<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n' + entry['system'] + '<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n' + entry['user'] + '<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n' + entry['assistant'] + '<|eot_id|>')


def create_chatml_format(entry: Dict[str, str]) -> str:
    """
    Alternative: Create ChatML format which is more universal.
    """
    return f"""<|im_start|>system
{entry['system']}<|im_end|>
<|im_start|>user
{entry['user']}<|im_end|>
<|im_start|>assistant
{entry['assistant']}<|im_end|>"""


def prepare_datasets(entries: List[Dict[str, Any]], 
                     output_dir: Path,
                     train_ratio: float = 0.9) -> tuple:
    """
    Prepare train and validation datasets.
    
    Returns paths to the created files.
    """
    # Filter out invalid entries
    formatted = []
    for entry in entries:
        result = format_for_llama_chat(entry)
        if result:
            formatted.append(result)
    
    print(f"\nTotal valid entries: {len(formatted)}")
    
    # Shuffle for randomness
    random.seed(42)
    random.shuffle(formatted)
    
    # Split into train/val
    split_idx = int(len(formatted) * train_ratio)
    train_data = formatted[:split_idx]
    val_data = formatted[split_idx:]
    
    print(f"Training samples: {len(train_data)}")
    print(f"Validation samples: {len(val_data)}")
    
    # Save as JSONL (most common format for fine-tuning)
    train_path = output_dir / "train.jsonl"
    val_path = output_dir / "val.jsonl"
    
    with open(train_path, 'w', encoding='utf-8') as f:
        for entry in train_data:
            # Save in the format expected by the training script
            record = {
                'messages': [
                    {'role': 'system', 'content': entry['system']},
                    {'role': 'user', 'content': entry['user']},
                    {'role': 'assistant', 'content': entry['assistant']}
                ],
                'metadata': {
                    'request_type': entry['request_type'],
                    'agent_role': entry['agent_role']
                }
            }
            f.write(json.dumps(record, ensure_ascii=False) + '\n')
    
    with open(val_path, 'w', encoding='utf-8') as f:
        for entry in val_data:
            record = {
                'messages': [
                    {'role': 'system', 'content': entry['system']},
                    {'role': 'user', 'content': entry['user']},
                    {'role': 'assistant', 'content': entry['assistant']}
                ],
                'metadata': {
                    'request_type': entry['request_type'],
                    'agent_role': entry['agent_role']
                }
            }
            f.write(json.dumps(record, ensure_ascii=False) + '\n')
    
    # Also save the full text versions for certain training approaches
    train_text_path = output_dir / "train_text.jsonl"
    with open(train_text_path, 'w', encoding='utf-8') as f:
        for entry in train_data:
            full_text = create_llama_format_text(entry)
            f.write(json.dumps({'text': full_text}, ensure_ascii=False) + '\n')
    
    return train_path, val_path


def print_statistics(entries: List[Dict[str, Any]]):
    """Print statistics about the dataset."""
    request_types = {}
    agent_roles = {}
    
    for entry in entries:
        rt = entry.get('requestType', 'unknown')
        ar = entry.get('agentRole', 'unknown')
        request_types[rt] = request_types.get(rt, 0) + 1
        agent_roles[ar] = agent_roles.get(ar, 0) + 1
    
    print("\n=== Dataset Statistics ===")
    print("\nRequest Types:")
    for rt, count in sorted(request_types.items(), key=lambda x: -x[1]):
        print(f"  {rt}: {count}")
    
    print("\nAgent Roles:")
    for ar, count in sorted(agent_roles.items(), key=lambda x: -x[1]):
        print(f"  {ar}: {count}")


def main():
    # Paths
    script_dir = Path(__file__).parent
    repo_root = script_dir.parent
    success_dir = repo_root / "LLM-training-data" / "success"
    output_dir = script_dir / "data"
    
    # Create output directory
    output_dir.mkdir(exist_ok=True)
    
    print("=" * 60)
    print("Preparing Dataset for Llama 3.2 1B Fine-tuning")
    print("=" * 60)
    print(f"\nSource: {success_dir}")
    print(f"Output: {output_dir}")
    
    # Load all training data
    print("\n--- Loading Training Data ---")
    entries = load_training_data(success_dir)
    print(f"\nLoaded {len(entries)} total entries")
    
    if len(entries) == 0:
        print("ERROR: No training data found!")
        return
    
    # Print statistics
    print_statistics(entries)
    
    # Prepare datasets
    print("\n--- Preparing Datasets ---")
    train_path, val_path = prepare_datasets(entries, output_dir)
    
    print(f"\n=== Output Files ===")
    print(f"Training data: {train_path}")
    print(f"Validation data: {val_path}")
    print(f"Training text (full format): {output_dir / 'train_text.jsonl'}")
    
    print("\nâœ“ Dataset preparation complete!")
    print("\nNext step: Run train.py to start fine-tuning")


if __name__ == "__main__":
    main()

