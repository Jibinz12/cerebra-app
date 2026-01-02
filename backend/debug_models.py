import os
from dotenv import load_dotenv
from google import genai

# 1. Load the key
load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    print("❌ CRITICAL ERROR: API Key not found in .env file.")
    exit()

print(f"🔑 Using API Key: {api_key[:5]}...{api_key[-5:]}")

# 2. Initialize Client
try:
    client = genai.Client(api_key=api_key)
    
    # 3. List Models
    print("\n📡 Connecting to Google Servers to list available models...")
    
    # We will simply print the name and display_name to be safe
    for m in client.models.list():
        print(f"   - Name: {m.name}")

    print("\n✅ DIAGNOSTIC COMPLETE")

except Exception as e:
    print(f"\n❌ CONNECTION FAILED: {e}")