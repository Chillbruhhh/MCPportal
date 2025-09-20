# Using OpenAI Requests Through OpenRouter - Complete Guide

Based on the Context7 library analysis, here's a comprehensive guide for using OpenAI requests through OpenRouter.

## Overview
OpenRouter provides a unified API to access hundreds of AI models (including OpenAI's GPT models) through a single endpoint, with features like automatic fallbacks, cost optimization, and easy integration.

## Quick Setup

### 1. Get Your OpenRouter API Key
- Sign up at [openrouter.ai](https://openrouter.ai)
- Generate an API key from your dashboard

### 2. Base URL and Headers
```python
BASE_URL = "https://openrouter.ai/api/v1"
HEADERS = {
    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
    "HTTP-Referer": "YOUR_SITE_URL",  # Optional, for rankings
    "X-Title": "YOUR_APP_NAME"        # Optional, for rankings
}
```

## Python Implementation

### Method 1: Using OpenAI SDK (Recommended)
```python
from openai import OpenAI

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key="YOUR_OPENROUTER_API_KEY",
)

completion = client.chat.completions.create(
    model="openai/gpt-4-turbo-preview",
    messages=[
        {"role": "user", "content": "Hello, world!"}
    ]
)

print(completion.choices[0].message.content)
```

### Method 2: Using OpenRouter Python Client
```python
from openrouter import OpenRouter

client = OpenRouter(api_key="YOUR_OPENROUTER_API_KEY")

response = client.chat.completions.create(
    model="openai/gpt-4-turbo-preview",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

### Method 3: Raw HTTP Requests
```python
import requests

response = requests.post(
    "https://openrouter.ai/api/v1/chat/completions",
    headers={
        "Authorization": "Bearer YOUR_OPENROUTER_API_KEY",
        "Content-Type": "application/json"
    },
    json={
        "model": "openai/gpt-4-turbo-preview",
        "messages": [{"role": "user", "content": "Hello!"}]
    }
)

result = response.json()
print(result['choices'][0]['message']['content'])
```

## JavaScript/Node.js Implementation

### Method 1: Using OpenAI Node.js SDK
```javascript
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: "YOUR_OPENROUTER_API_KEY",
});

const completion = await openai.chat.completions.create({
  model: "openai/gpt-4-turbo-preview",
  messages: [{ role: "user", content: "Hello, world!" }],
});

console.log(completion.choices[0].message.content);
```

### Method 2: Using Fetch API
```javascript
const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'openai/gpt-4-turbo-preview',
    messages: [{ role: 'user', content: 'Hello!' }]
  })
});

const data = await response.json();
console.log(data.choices[0].message.content);
```

## Available OpenAI Models on OpenRouter

### GPT-4 Models
- `openai/gpt-4-turbo-preview`
- `openai/gpt-4`
- `openai/gpt-4-32k`

### GPT-3.5 Models
- `openai/gpt-3.5-turbo`
- `openai/gpt-3.5-turbo-16k`

### GPT-4o Models
- `openai/gpt-4o`
- `openai/gpt-4o-mini`

## Advanced Features

### Streaming Responses
```python
import openai

client = openai.OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key="YOUR_OPENROUTER_API_KEY"
)

stream = client.chat.completions.create(
    model="openai/gpt-4-turbo-preview",
    messages=[{"role": "user", "content": "Tell me a story"}],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content is not None:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

### Function Calling
```python
import openai

client = openai.OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key="YOUR_OPENROUTER_API_KEY"
)

response = client.chat.completions.create(
    model="openai/gpt-4-turbo-preview",
    messages=[{"role": "user", "content": "What's the weather in Tokyo?"}],
    tools=[{
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get weather information for a location",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {"type": "string"}
                },
                "required": ["location"]
            }
        }
    }]
)

print(response.choices[0].message.tool_calls)
```

### Error Handling
```python
import openai
from openai import OpenAI

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key="YOUR_OPENROUTER_API_KEY"
)

try:
    response = client.chat.completions.create(
        model="openai/gpt-4-turbo-preview",
        messages=[{"role": "user", "content": "Hello!"}]
    )
except openai.APIError as e:
    print(f"API Error: {e}")
except openai.RateLimitError as e:
    print(f"Rate limit exceeded: {e}")
except Exception as e:
    print(f"Unexpected error: {e}")
```

## Environment Variables Setup
```bash
# .env file
OPENROUTER_API_KEY=your_api_key_here
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

## Complete Working Example

### Python Flask App
```python
from flask import Flask, request, jsonify
from openai import OpenAI
import os

app = Flask(__name__)

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY")
)

@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    messages = data.get('messages', [])
    
    try:
        response = client.chat.completions.create(
            model="openai/gpt-4-turbo-preview",
            messages=messages
        )
        
        return jsonify({
            "response": response.choices[0].message.content,
            "model": response.model,
            "usage": response.usage.dict()
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True)
```

### Node.js Express App
```javascript
const express = require('express');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();
app.use(express.json());

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

app.post('/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    
    const completion = await openai.chat.completions.create({
      model: "openai/gpt-4-turbo-preview",
      messages: messages,
    });

    res.json({
      response: completion.choices[0].message.content,
      model: completion.model,
      usage: completion.usage
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
