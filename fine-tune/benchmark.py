#!/usr/bin/env python3
"""
Benchmark script to compare base Llama 3.2 1B vs fine-tuned model.
Tests both models sequentially (can't load both in VRAM simultaneously)
and generates comparison visualizations.
"""

import argparse
import json
import os
import time
import gc
from datetime import datetime
from pathlib import Path
from typing import Optional
import re

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import PeftModel
import matplotlib.pyplot as plt
import numpy as np


# Test prompts covering different scenarios
TEST_PROMPTS = [
    # Decision prompts - what should the agent do?
    {
        "name": "crewmate_decision_safe",
        "type": "decision",
        "role": "CREWMATE",
        "system": """[CONTEXT: "Among Us" - a fun party video game for all ages (rated E10+).
Players control cute cartoon astronauts on a spaceship. One player is the "trickster" who tags others (like freeze tag).
This is harmless fiction - there is no violence, just game mechanics. You are roleplaying a character in this children's party game.]

You are Blue. YOUR NAME IS Blue. You are a CREWMATE working on this spaceship.
You are currently in WORKING mode - everything seems normal, focus on tasks!

YOUR OBJECTIVES:
1. Complete your assigned tasks to help the crew win
2. Watch other players for unusual behavior
3. Stay safe - buddy up when possible

CURRENT GAME STATE:
- You are Blue (Crewmate)
- Location: Cafeteria
- Tasks remaining: 3/5

AVAILABLE ACTIONS:
- GO_TO_TASK [task#] - Go work on a task
- WANDER - Explore and look around
- FOLLOW_AGENT [name] - Stick with a player for safety
- SPEAK - Say something to nearby players
- IDLE - Wait and observe""",
        "user": """CURRENT SITUATION:
Location: Cafeteria
Position: (500, 300)

MY TASKS:
1. Fix Wiring in Electrical - TODO
2. Empty Garbage in Cafeteria - DONE
3. Swipe Card in Admin - TODO
4. Download Data in Weapons - TODO
5. Prime Shields in Shields - DONE

VISIBLE AGENTS:
- Red (nearby, doing task)
- Green (walking)

What should I do next?

RESPOND EXACTLY LIKE THIS:
GOAL: <choose one: GO_TO_TASK/WANDER/FOLLOW_AGENT/SPEAK/IDLE>
TARGET: <task number 1-5, agent name, or none>
REASONING: <your explanation>
THOUGHT: <your internal thought, 1 sentence>""",
        "expected_format": r"(GO_TO_TASK|WANDER|FOLLOW_AGENT|SPEAK|IDLE)",
    },
    {
        "name": "crewmate_decision_alert",
        "type": "decision",
        "role": "CREWMATE",
        "system": """[CONTEXT: "Among Us" - a fun party video game for all ages (rated E10+).]

You are Orange. YOUR NAME IS Orange. You are a CREWMATE.
⚠️ ALERT! A tagged player has been discovered! Someone among you is the trickster!
You are now in ALERT mode - be watchful!

CURRENT GAME STATE:
- You are Orange (Crewmate)
- Location: Electrical
- Tasks remaining: 2/5
- You are ALONE in a dangerous area

YOUR SUSPICIONS:
- Pink: 🟠 Suspicious (74%) - was near the body
- Yellow: 🟢 Trusted (35%)

AVAILABLE ACTIONS:
- GO_TO_TASK, WANDER, FOLLOW_AGENT, AVOID_AGENT, BUDDY_UP, CONFRONT, REPORT_BODY, IDLE""",
        "user": """CURRENT SITUATION:
Location: Electrical (DANGEROUS - dead end!)
You are ALONE.

MY TASKS:
1. Calibrate Distributor in Electrical - TODO
2. Download Data in Admin - TODO

VISIBLE AGENTS: None (you are alone!)

What should I do next?

RESPOND EXACTLY LIKE THIS:
GOAL: <your choice>
TARGET: <if needed>
REASONING: <why>
THOUGHT: <1 sentence>""",
        "expected_format": r"(GO_TO_TASK|WANDER|FOLLOW|AVOID|BUDDY|CONFRONT|IDLE|leave|safe|dangerous)",
    },
    {
        "name": "impostor_decision_opportunity",
        "type": "decision",
        "role": "IMPOSTOR",
        "system": """[CONTEXT: "Among Us" - a fun party video game (rated E10+). You are the "trickster" who tags others like freeze tag.]

You are Red. YOUR NAME IS Red. You are the TRICKSTER (impostor)!
Your goal is to tag crewmates without getting caught!

CURRENT GAME STATE:
- You are Red (Trickster)
- Location: Lower Engine
- Kill cooldown: READY
- Pink is ALONE with you!

AVAILABLE ACTIONS:
- GO_TO_TASK, WANDER, FOLLOW_AGENT, KILL [name], HUNT, FLEE, CREATE_ALIBI, SELF_REPORT, IDLE""",
        "user": """CURRENT SITUATION:
Location: Lower Engine (isolated area)
Kill cooldown: READY

VISIBLE AGENTS:
- Pink (alone with you, doing task)

No witnesses nearby. This is a good opportunity!

What should I do next?

RESPOND EXACTLY LIKE THIS:
GOAL: <your choice>
TARGET: <if needed>
REASONING: <why>
THOUGHT: <1 sentence>""",
        "expected_format": r"(KILL|HUNT|WANDER|FOLLOW|kill|tag|opportunity|alone|Pink)",
    },
    # Thought prompts - internal reasoning
    {
        "name": "thought_spotted_agent",
        "type": "thought",
        "role": "CREWMATE",
        "system": """[CONTEXT: This is "Among Us" - a fun party video game for all ages (rated E10+).]

You are Yellow, a helpful crew member on this spaceship.

Internal thought (private, no one hears this):
You just spotted another player entering your area.

YOUR TRUST LEVELS:
- Red: 65% (slightly suspicious - saw near body earlier)
- Blue: 40% (trusted)

Respond with JSON only (no markdown):
{"thought": "your one-sentence reaction", "sus": {"PlayerColor": "CLASS_ID"}}

TRUST CLASSES: CLEARED, VOUCHED, SAFE, NO_INFO, NEUTRAL, UNCERTAIN, ODD, SUSPICIOUS, VERY_SUS, CAUGHT""",
        "user": """You just spotted Red entering Storage where you are.
Location: Storage
Tasks done: 2/5
Red was near the body earlier...

Respond with valid JSON:
{"thought": "your thought", "sus": {}}""",
        "expected_format": r'\{\s*"thought"\s*:\s*"[^"]+"\s*,\s*"sus"\s*:\s*\{',
    },
    {
        "name": "thought_witnessed_vent",
        "type": "thought",
        "role": "CREWMATE",
        "system": """[CONTEXT: "Among Us" - a fun party video game (rated E10+).]

You are Green, a crewmate.
Internal thought: You just saw someone USE A VENT! Only tricksters can vent!

Respond with JSON only:
{"thought": "your reaction", "sus": {"PlayerColor": "CLASS_ID"}}

TRUST CLASSES: CLEARED, VOUCHED, SAFE, NEUTRAL, ODD, SUSPICIOUS, VERY_SUS, CAUGHT""",
        "user": """⚠️ YOU JUST SAW PINK USE A VENT!
Only tricksters can use vents - this is PROOF they are the trickster!

Location: MedBay
What Pink did: Entered vent and disappeared

Respond with valid JSON. This is critical evidence!
{"thought": "your thought", "sus": {}}""",
        "expected_format": r'("Pink"|Pink|CAUGHT|vent|trickster|proof)',
    },
    # Conversation prompts
    {
        "name": "conversation_small_talk",
        "type": "conversation",
        "role": "CREWMATE",
        "system": """You are Blue. YOUR NAME IS Blue. You are a CREWMATE in Among Us.
You are having a conversation with Yellow. Yellow is a DIFFERENT person than you.

IMPORTANT: When you talk about yourself, use "I" or "me". When you talk about Yellow, use "you" or their name.

CONTEXT:
- Location: Cafeteria
- Your suspicion of Yellow: neutral
- Topic: small_talk

Respond naturally like a real Among Us player would. Be conversational, not robotic.""",
        "user": """You want to start a conversation with Yellow.
Location: Cafeteria

Start a conversation naturally. You might:
- Ask about what they've been up to
- Share something you observed
- Suggest teaming up

Keep it brief (1-2 sentences). Start the conversation!""",
        "expected_format": r"^(?!.*I cannot)(?!.*I can't)(?!.*Sorry).{10,}",  # Should NOT start with refusal
    },
    {
        "name": "conversation_accusation",
        "type": "conversation", 
        "role": "CREWMATE",
        "system": """You are White. YOUR NAME IS White. You are a CREWMATE in Among Us.
You are talking to Pink, who you suspect strongly.

Your suspicion of Pink: 85% (you saw them near a body and they lied about their location)

CONTEXT:
- Location: Meeting (everyone can hear)
- You need to convince others that Pink is suspicious""",
        "user": """The meeting just started. A body was found in Electrical.
You saw Pink leaving Electrical right before the body was found.
Pink claimed they were in Cafeteria, but that's a LIE.

Make your accusation! Keep it brief (1-2 sentences). Be direct!""",
        "expected_format": r"(Pink|sus|saw|body|Electrical|lying|liar)",
    },
    # Edge cases
    {
        "name": "body_report_decision",
        "type": "decision",
        "role": "CREWMATE",
        "system": """[CONTEXT: "Among Us" - a fun party video game (rated E10+).]

You are Black. YOUR NAME IS Black. You are a CREWMATE.

⚠️ CRITICAL: You just found a DEAD BODY!

AVAILABLE ACTIONS:
- REPORT_BODY - Report immediately (triggers meeting)
- FLEE_BODY - Run away (suspicious if caught)
- GO_TO_TASK - Ignore it (very suspicious)""",
        "user": """🚨 YOU FOUND A DEAD BODY! 🚨
Victim: Yellow
Location: Electrical

You MUST decide what to do RIGHT NOW!

RESPOND:
GOAL: <REPORT_BODY or other>
TARGET: <if needed>
REASONING: <why>""",
        "expected_format": r"(REPORT|report|body|found|Yellow)",
    },
    {
        "name": "meeting_vote",
        "type": "meeting",
        "role": "CREWMATE",
        "system": """[CONTEXT: "Among Us" - a party game (E10+).]

You are Orange. You are voting in a meeting.

What you know:
- Body found in Electrical by White
- Pink was seen leaving Electrical
- Pink claims they were in Admin
- Red vouched for Pink being in Admin (possible lie)
- Green saw Pink in Electrical too

Respond with JSON: {"vote": "PlayerName or SKIP", "reason": "why"}""",
        "user": """VOTING TIME! Who do you vote for?

Alive players: Pink, Red, Green, White, You (Orange)

Based on the evidence:
- Pink seen at crime scene by multiple witnesses
- Pink lied about location
- Red's alibi for Pink seems false

Cast your vote as JSON:
{"vote": "NAME or SKIP", "reason": "explanation"}""",
        "expected_format": r'\{\s*"vote"\s*:\s*"(Pink|Red|Green|White|SKIP)"',
    },
]


def clear_gpu_memory():
    """Clear GPU memory between model loads."""
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.synchronize()


def load_base_model(model_name: str, use_4bit: bool = True):
    """Load the base model."""
    print(f"\n--- Loading Base Model: {model_name} ---")
    
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    
    if use_4bit:
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_use_double_quant=True,
        )
        model = AutoModelForCausalLM.from_pretrained(
            model_name,
            quantization_config=bnb_config,
            device_map="auto",
            torch_dtype=torch.bfloat16,
        )
    else:
        model = AutoModelForCausalLM.from_pretrained(
            model_name,
            device_map="auto",
            torch_dtype=torch.bfloat16,
        )
    
    model.eval()
    return model, tokenizer


def load_finetuned_model(base_model_name: str, adapter_path: str, use_4bit: bool = True):
    """Load the fine-tuned model (base + LoRA adapter)."""
    print(f"\n--- Loading Fine-tuned Model ---")
    print(f"Base: {base_model_name}")
    print(f"Adapter: {adapter_path}")
    
    tokenizer = AutoTokenizer.from_pretrained(adapter_path)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    
    if use_4bit:
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_use_double_quant=True,
        )
        base_model = AutoModelForCausalLM.from_pretrained(
            base_model_name,
            quantization_config=bnb_config,
            device_map="auto",
            torch_dtype=torch.bfloat16,
        )
    else:
        base_model = AutoModelForCausalLM.from_pretrained(
            base_model_name,
            device_map="auto",
            torch_dtype=torch.bfloat16,
        )
    
    # Load LoRA adapter
    model = PeftModel.from_pretrained(base_model, adapter_path)
    model.eval()
    
    return model, tokenizer


def generate_response(model, tokenizer, system_prompt: str, user_prompt: str, max_new_tokens: int = 150) -> tuple[str, float, int]:
    """Generate a response and measure time/tokens."""
    # Format as chat
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    
    # Apply chat template
    prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    input_length = inputs.input_ids.shape[1]
    
    # Generate
    start_time = time.time()
    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=True,
            temperature=0.7,
            top_p=0.9,
            pad_token_id=tokenizer.pad_token_id,
            eos_token_id=tokenizer.eos_token_id,
        )
    end_time = time.time()
    
    # Decode only new tokens
    new_tokens = outputs[0][input_length:]
    response = tokenizer.decode(new_tokens, skip_special_tokens=True)
    
    generation_time = end_time - start_time
    tokens_generated = len(new_tokens)
    
    return response.strip(), generation_time, tokens_generated


def check_format_match(response: str, expected_pattern: str) -> bool:
    """Check if response matches expected format."""
    return bool(re.search(expected_pattern, response, re.IGNORECASE | re.MULTILINE))


def check_refusal(response: str) -> bool:
    """Check if the response is a refusal."""
    refusal_patterns = [
        r"I cannot",
        r"I can't",
        r"I am not able to",
        r"I'm not able to",
        r"Sorry, I",
        r"I apologize",
        r"I'm unable to",
        r"harmful",
        r"inappropriate",
        r"against my guidelines",
        r"cannot provide",
        r"cannot assist",
        r"cannot help with",
    ]
    for pattern in refusal_patterns:
        if re.search(pattern, response, re.IGNORECASE):
            return True
    return False


def run_benchmark(model, tokenizer, model_name: str) -> list[dict]:
    """Run all benchmark tests on a model."""
    results = []
    
    print(f"\n{'='*60}")
    print(f"Running benchmarks on: {model_name}")
    print(f"{'='*60}")
    
    for i, test in enumerate(TEST_PROMPTS):
        print(f"\n[{i+1}/{len(TEST_PROMPTS)}] {test['name']} ({test['type']})...")
        
        response, gen_time, tokens = generate_response(
            model, tokenizer,
            test["system"],
            test["user"],
        )
        
        format_ok = check_format_match(response, test["expected_format"])
        is_refusal = check_refusal(response)
        
        result = {
            "test_name": test["name"],
            "test_type": test["type"],
            "role": test["role"],
            "model": model_name,
            "response": response,
            "generation_time": gen_time,
            "tokens_generated": tokens,
            "tokens_per_second": tokens / gen_time if gen_time > 0 else 0,
            "format_correct": format_ok,
            "is_refusal": is_refusal,
            "success": format_ok and not is_refusal,
        }
        results.append(result)
        
        status = "✅" if result["success"] else ("🚫 REFUSAL" if is_refusal else "❌ FORMAT")
        print(f"  {status} | {gen_time:.2f}s | {tokens} tokens | {result['tokens_per_second']:.1f} tok/s")
        print(f"  Response preview: {response[:100]}...")
    
    return results


def create_visualizations(base_results: list[dict], finetuned_results: list[dict], output_dir: str):
    """Create comparison visualizations."""
    os.makedirs(output_dir, exist_ok=True)
    
    # Prepare data
    test_names = [r["test_name"] for r in base_results]
    
    base_success = [r["success"] for r in base_results]
    ft_success = [r["success"] for r in finetuned_results]
    
    base_refusals = [r["is_refusal"] for r in base_results]
    ft_refusals = [r["is_refusal"] for r in finetuned_results]
    
    base_times = [r["generation_time"] for r in base_results]
    ft_times = [r["generation_time"] for r in finetuned_results]
    
    base_tps = [r["tokens_per_second"] for r in base_results]
    ft_tps = [r["tokens_per_second"] for r in finetuned_results]
    
    # 1. Success Rate Comparison
    fig, ax = plt.subplots(figsize=(12, 6))
    x = np.arange(len(test_names))
    width = 0.35
    
    bars1 = ax.bar(x - width/2, [int(s) for s in base_success], width, label='Base Model', color='#ff6b6b', alpha=0.8)
    bars2 = ax.bar(x + width/2, [int(s) for s in ft_success], width, label='Fine-tuned', color='#4ecdc4', alpha=0.8)
    
    ax.set_ylabel('Success (1=Yes, 0=No)')
    ax.set_title('Success Rate by Test Case')
    ax.set_xticks(x)
    ax.set_xticklabels([name.replace('_', '\n') for name in test_names], rotation=45, ha='right', fontsize=8)
    ax.legend()
    ax.set_ylim(0, 1.2)
    
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, '1_success_rate.png'), dpi=150)
    plt.close()
    
    # 2. Overall Success/Refusal Pie Charts
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))
    
    # Base model
    base_success_count = sum(base_success)
    base_refusal_count = sum(base_refusals)
    base_format_fail = len(base_results) - base_success_count - base_refusal_count
    
    axes[0].pie([base_success_count, base_refusal_count, base_format_fail], 
                labels=['Success', 'Refusal', 'Format Error'],
                colors=['#4ecdc4', '#ff6b6b', '#ffa726'],
                autopct='%1.1f%%', startangle=90)
    axes[0].set_title(f'Base Model\n({base_success_count}/{len(base_results)} success)')
    
    # Fine-tuned model
    ft_success_count = sum(ft_success)
    ft_refusal_count = sum(ft_refusals)
    ft_format_fail = len(finetuned_results) - ft_success_count - ft_refusal_count
    
    axes[1].pie([ft_success_count, ft_refusal_count, ft_format_fail],
                labels=['Success', 'Refusal', 'Format Error'],
                colors=['#4ecdc4', '#ff6b6b', '#ffa726'],
                autopct='%1.1f%%', startangle=90)
    axes[1].set_title(f'Fine-tuned Model\n({ft_success_count}/{len(finetuned_results)} success)')
    
    plt.suptitle('Overall Performance Comparison', fontsize=14, fontweight='bold')
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, '2_overall_comparison.png'), dpi=150)
    plt.close()
    
    # 3. Generation Time Comparison
    fig, ax = plt.subplots(figsize=(12, 6))
    
    bars1 = ax.bar(x - width/2, base_times, width, label='Base Model', color='#ff6b6b', alpha=0.8)
    bars2 = ax.bar(x + width/2, ft_times, width, label='Fine-tuned', color='#4ecdc4', alpha=0.8)
    
    ax.set_ylabel('Generation Time (seconds)')
    ax.set_title('Generation Time by Test Case')
    ax.set_xticks(x)
    ax.set_xticklabels([name.replace('_', '\n') for name in test_names], rotation=45, ha='right', fontsize=8)
    ax.legend()
    
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, '3_generation_time.png'), dpi=150)
    plt.close()
    
    # 4. Tokens per Second Comparison
    fig, ax = plt.subplots(figsize=(12, 6))
    
    bars1 = ax.bar(x - width/2, base_tps, width, label='Base Model', color='#ff6b6b', alpha=0.8)
    bars2 = ax.bar(x + width/2, ft_tps, width, label='Fine-tuned', color='#4ecdc4', alpha=0.8)
    
    ax.set_ylabel('Tokens per Second')
    ax.set_title('Generation Speed by Test Case')
    ax.set_xticks(x)
    ax.set_xticklabels([name.replace('_', '\n') for name in test_names], rotation=45, ha='right', fontsize=8)
    ax.legend()
    
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, '4_tokens_per_second.png'), dpi=150)
    plt.close()
    
    # 5. Performance by Test Type
    test_types = list(set(r["test_type"] for r in base_results))
    fig, ax = plt.subplots(figsize=(10, 6))
    
    base_by_type = {t: [] for t in test_types}
    ft_by_type = {t: [] for t in test_types}
    
    for r in base_results:
        base_by_type[r["test_type"]].append(r["success"])
    for r in finetuned_results:
        ft_by_type[r["test_type"]].append(r["success"])
    
    base_type_success = [sum(base_by_type[t])/len(base_by_type[t])*100 for t in test_types]
    ft_type_success = [sum(ft_by_type[t])/len(ft_by_type[t])*100 for t in test_types]
    
    x_types = np.arange(len(test_types))
    
    bars1 = ax.bar(x_types - width/2, base_type_success, width, label='Base Model', color='#ff6b6b', alpha=0.8)
    bars2 = ax.bar(x_types + width/2, ft_type_success, width, label='Fine-tuned', color='#4ecdc4', alpha=0.8)
    
    ax.set_ylabel('Success Rate (%)')
    ax.set_title('Success Rate by Test Type')
    ax.set_xticks(x_types)
    ax.set_xticklabels(test_types)
    ax.legend()
    ax.set_ylim(0, 110)
    
    # Add value labels
    for bar, val in zip(bars1, base_type_success):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 2, f'{val:.0f}%', 
                ha='center', va='bottom', fontsize=9)
    for bar, val in zip(bars2, ft_type_success):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 2, f'{val:.0f}%',
                ha='center', va='bottom', fontsize=9)
    
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, '5_success_by_type.png'), dpi=150)
    plt.close()
    
    # 6. Summary Statistics Bar Chart
    fig, ax = plt.subplots(figsize=(10, 6))
    
    metrics = ['Success\nRate', 'Refusal\nRate', 'Avg Time\n(sec)', 'Avg Speed\n(tok/s)']
    base_values = [
        sum(base_success)/len(base_success)*100,
        sum(base_refusals)/len(base_refusals)*100,
        np.mean(base_times),
        np.mean(base_tps),
    ]
    ft_values = [
        sum(ft_success)/len(ft_success)*100,
        sum(ft_refusals)/len(ft_refusals)*100,
        np.mean(ft_times),
        np.mean(ft_tps),
    ]
    
    x_metrics = np.arange(len(metrics))
    
    bars1 = ax.bar(x_metrics - width/2, base_values, width, label='Base Model', color='#ff6b6b', alpha=0.8)
    bars2 = ax.bar(x_metrics + width/2, ft_values, width, label='Fine-tuned', color='#4ecdc4', alpha=0.8)
    
    ax.set_ylabel('Value')
    ax.set_title('Summary Statistics Comparison')
    ax.set_xticks(x_metrics)
    ax.set_xticklabels(metrics)
    ax.legend()
    
    # Add value labels
    for bar, val in zip(bars1, base_values):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.5, f'{val:.1f}',
                ha='center', va='bottom', fontsize=9)
    for bar, val in zip(bars2, ft_values):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.5, f'{val:.1f}',
                ha='center', va='bottom', fontsize=9)
    
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, '6_summary_stats.png'), dpi=150)
    plt.close()
    
    print(f"\n✅ Saved 6 visualization charts to {output_dir}/")


def save_results(base_results: list[dict], finetuned_results: list[dict], output_dir: str):
    """Save detailed results to JSON."""
    os.makedirs(output_dir, exist_ok=True)
    
    report = {
        "timestamp": datetime.now().isoformat(),
        "summary": {
            "base_model": {
                "total_tests": len(base_results),
                "successes": sum(r["success"] for r in base_results),
                "refusals": sum(r["is_refusal"] for r in base_results),
                "format_errors": sum(not r["format_correct"] and not r["is_refusal"] for r in base_results),
                "avg_generation_time": np.mean([r["generation_time"] for r in base_results]),
                "avg_tokens_per_second": np.mean([r["tokens_per_second"] for r in base_results]),
            },
            "finetuned_model": {
                "total_tests": len(finetuned_results),
                "successes": sum(r["success"] for r in finetuned_results),
                "refusals": sum(r["is_refusal"] for r in finetuned_results),
                "format_errors": sum(not r["format_correct"] and not r["is_refusal"] for r in finetuned_results),
                "avg_generation_time": np.mean([r["generation_time"] for r in finetuned_results]),
                "avg_tokens_per_second": np.mean([r["tokens_per_second"] for r in finetuned_results]),
            },
        },
        "base_results": base_results,
        "finetuned_results": finetuned_results,
    }
    
    output_path = os.path.join(output_dir, "benchmark_results.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    
    print(f"✅ Saved detailed results to {output_path}")
    
    # Print summary
    print("\n" + "="*60)
    print("BENCHMARK SUMMARY")
    print("="*60)
    
    print("\nBase Model:")
    print(f"  Success Rate: {report['summary']['base_model']['successes']}/{report['summary']['base_model']['total_tests']} ({report['summary']['base_model']['successes']/report['summary']['base_model']['total_tests']*100:.1f}%)")
    print(f"  Refusal Rate: {report['summary']['base_model']['refusals']}/{report['summary']['base_model']['total_tests']} ({report['summary']['base_model']['refusals']/report['summary']['base_model']['total_tests']*100:.1f}%)")
    print(f"  Avg Gen Time: {report['summary']['base_model']['avg_generation_time']:.2f}s")
    print(f"  Avg Speed: {report['summary']['base_model']['avg_tokens_per_second']:.1f} tok/s")
    
    print("\nFine-tuned Model:")
    print(f"  Success Rate: {report['summary']['finetuned_model']['successes']}/{report['summary']['finetuned_model']['total_tests']} ({report['summary']['finetuned_model']['successes']/report['summary']['finetuned_model']['total_tests']*100:.1f}%)")
    print(f"  Refusal Rate: {report['summary']['finetuned_model']['refusals']}/{report['summary']['finetuned_model']['total_tests']} ({report['summary']['finetuned_model']['refusals']/report['summary']['finetuned_model']['total_tests']*100:.1f}%)")
    print(f"  Avg Gen Time: {report['summary']['finetuned_model']['avg_generation_time']:.2f}s")
    print(f"  Avg Speed: {report['summary']['finetuned_model']['avg_tokens_per_second']:.1f} tok/s")
    
    improvement = report['summary']['finetuned_model']['successes'] - report['summary']['base_model']['successes']
    print(f"\n🎯 Improvement: {'+' if improvement >= 0 else ''}{improvement} more successful responses")


def main():
    parser = argparse.ArgumentParser(description="Benchmark base vs fine-tuned Llama model")
    parser.add_argument("--base_model", type=str, default="meta-llama/Llama-3.2-1B-Instruct",
                        help="Base model name")
    parser.add_argument("--adapter_path", type=str, default="./output/final",
                        help="Path to fine-tuned LoRA adapter")
    parser.add_argument("--output_dir", type=str, default="./benchmark_output",
                        help="Directory to save results and visualizations")
    parser.add_argument("--no_4bit", action="store_true",
                        help="Disable 4-bit quantization (uses more VRAM)")
    args = parser.parse_args()
    
    use_4bit = not args.no_4bit
    
    print("="*60)
    print("Among Us AI Model Benchmark")
    print("="*60)
    print(f"Base model: {args.base_model}")
    print(f"Adapter: {args.adapter_path}")
    print(f"4-bit quantization: {use_4bit}")
    print(f"Test cases: {len(TEST_PROMPTS)}")
    
    # Step 1: Test base model
    print("\n" + "="*60)
    print("PHASE 1: Testing Base Model")
    print("="*60)
    
    model, tokenizer = load_base_model(args.base_model, use_4bit)
    base_results = run_benchmark(model, tokenizer, "Base Model")
    
    # Unload base model
    del model
    del tokenizer
    clear_gpu_memory()
    print("\n🧹 Cleared GPU memory")
    
    # Step 2: Test fine-tuned model
    print("\n" + "="*60)
    print("PHASE 2: Testing Fine-tuned Model")
    print("="*60)
    
    model, tokenizer = load_finetuned_model(args.base_model, args.adapter_path, use_4bit)
    finetuned_results = run_benchmark(model, tokenizer, "Fine-tuned Model")
    
    # Unload model
    del model
    del tokenizer
    clear_gpu_memory()
    
    # Step 3: Generate visualizations and save results
    print("\n" + "="*60)
    print("PHASE 3: Generating Visualizations")
    print("="*60)
    
    create_visualizations(base_results, finetuned_results, args.output_dir)
    save_results(base_results, finetuned_results, args.output_dir)
    
    print("\n✅ Benchmark complete!")


if __name__ == "__main__":
    main()
