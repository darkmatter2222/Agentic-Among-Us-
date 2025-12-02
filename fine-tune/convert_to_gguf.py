"""
Convert HuggingFace Model to GGUF Format

This script converts the merged HuggingFace model to GGUF format
for use with llama.cpp.

Requires: llama.cpp's convert scripts (included in llama.cpp repo)

Usage:
    python convert_to_gguf.py --model_path ./merged_model
"""

import argparse
import subprocess
import sys
from pathlib import Path
import shutil


def parse_args():
    parser = argparse.ArgumentParser(description="Convert model to GGUF")
    parser.add_argument(
        "--model_path",
        type=str,
        required=True,
        help="Path to the HuggingFace model directory"
    )
    parser.add_argument(
        "--output_dir",
        type=str,
        default="./gguf_model",
        help="Output directory for GGUF files"
    )
    parser.add_argument(
        "--quantization",
        type=str,
        default="Q5_K_M",
        choices=["F16", "F32", "Q4_0", "Q4_1", "Q5_0", "Q5_1", "Q5_K_M", "Q8_0"],
        help="Quantization type"
    )
    parser.add_argument(
        "--llama_cpp_path",
        type=str,
        default=None,
        help="Path to llama.cpp repository (if not in PATH)"
    )
    return parser.parse_args()


def find_llama_cpp():
    """Find llama.cpp installation."""
    # Check common locations
    possible_paths = [
        Path.home() / "llama.cpp",
        Path("/opt/llama.cpp"),
        Path("C:/llama.cpp"),
        Path("./llama.cpp"),
    ]
    
    for path in possible_paths:
        if path.exists() and (path / "convert_hf_to_gguf.py").exists():
            return path
    
    return None


def main():
    args = parse_args()
    
    print("=" * 60)
    print("Converting Model to GGUF Format")
    print("=" * 60)
    
    model_path = Path(args.model_path)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    if not model_path.exists():
        print(f"ERROR: Model path not found: {model_path}")
        sys.exit(1)
    
    # Find llama.cpp
    if args.llama_cpp_path:
        llama_cpp = Path(args.llama_cpp_path)
    else:
        llama_cpp = find_llama_cpp()
    
    if not llama_cpp or not llama_cpp.exists():
        print("\nllama.cpp not found. To install:")
        print("  git clone https://github.com/ggerganov/llama.cpp")
        print("  cd llama.cpp && make")
        print("\nAlternatively, you can convert using HuggingFace's tools:")
        print_hf_conversion_instructions(model_path, output_dir, args.quantization)
        return
    
    convert_script = llama_cpp / "convert_hf_to_gguf.py"
    quantize_bin = llama_cpp / "llama-quantize"
    
    if sys.platform == "win32":
        quantize_bin = llama_cpp / "llama-quantize.exe"
        if not quantize_bin.exists():
            quantize_bin = llama_cpp / "build" / "bin" / "Release" / "llama-quantize.exe"
    
    # Step 1: Convert to F16 GGUF
    print(f"\n1. Converting HuggingFace model to GGUF (F16)...")
    f16_output = output_dir / "model-f16.gguf"
    
    cmd = [
        sys.executable,
        str(convert_script),
        str(model_path),
        "--outfile", str(f16_output),
        "--outtype", "f16"
    ]
    
    print(f"   Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if result.returncode != 0:
        print(f"ERROR: Conversion failed")
        print(result.stderr)
        sys.exit(1)
    
    print(f"   ✓ F16 GGUF created: {f16_output}")
    
    # Step 2: Quantize
    if args.quantization != "F16":
        print(f"\n2. Quantizing to {args.quantization}...")
        quant_output = output_dir / f"model-{args.quantization}.gguf"
        
        if not quantize_bin.exists():
            print(f"   WARNING: llama-quantize not found at {quantize_bin}")
            print(f"   Skipping quantization. You can quantize manually:")
            print(f"   {quantize_bin} {f16_output} {quant_output} {args.quantization}")
        else:
            cmd = [str(quantize_bin), str(f16_output), str(quant_output), args.quantization]
            print(f"   Running: {' '.join(cmd)}")
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode != 0:
                print(f"ERROR: Quantization failed")
                print(result.stderr)
            else:
                print(f"   ✓ Quantized GGUF created: {quant_output}")
                
                # Remove F16 version to save space (optional)
                # f16_output.unlink()
    
    print("\n" + "=" * 60)
    print("Conversion Complete!")
    print("=" * 60)
    
    print(f"\nGGUF files in: {output_dir}")
    for f in output_dir.glob("*.gguf"):
        size_mb = f.stat().st_size / (1024 * 1024)
        print(f"  - {f.name} ({size_mb:.1f} MB)")
    
    print(f"\nTo use with llama.cpp server:")
    quant_file = output_dir / f"model-{args.quantization}.gguf"
    if not quant_file.exists():
        quant_file = f16_output
    print(f"  ./llama-server -m {quant_file} --port 8080")
    
    print(f"\nTo update your Among Us docker deployment:")
    print(f"  1. Copy the GGUF file to your docker-manage/LLM/models directory")
    print(f"  2. Update the model path in your docker compose config")
    print(f"  3. Restart the LLM container")


def print_hf_conversion_instructions(model_path, output_dir, quantization):
    """Print instructions for converting without llama.cpp installed locally."""
    print("\n" + "=" * 60)
    print("Manual Conversion Instructions")
    print("=" * 60)
    
    print(f"""
Option 1: Use llama.cpp docker container
-----------------------------------------
docker run --rm -v {model_path}:/model -v {output_dir}:/output \\
    ghcr.io/ggerganov/llama.cpp:full \\
    python3 /llama.cpp/convert_hf_to_gguf.py /model --outfile /output/model-f16.gguf

Option 2: Clone and use llama.cpp
---------------------------------
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
pip install -r requirements.txt
python convert_hf_to_gguf.py {model_path} --outfile {output_dir}/model-f16.gguf --outtype f16

# Then quantize:
make llama-quantize
./llama-quantize {output_dir}/model-f16.gguf {output_dir}/model-{quantization}.gguf {quantization}

Option 3: Use ctransformers (Python)
------------------------------------
pip install ctransformers[cuda]
# Then use ctransformers to load the HF model directly
""")


if __name__ == "__main__":
    main()
