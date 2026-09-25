/**
 * services/aiProvider.js
 *
 * Unified free-tier AI provider with automatic failover:
 *   1. Google Gemini Flash (Primary  -- 15 RPM free)
 *   2. Groq / Llama-3.1-8B (Backup  -- 30 RPM free)
 *   3. Ollama / Llama-3.2  (Offline -- unlimited, slow on CPU)
 *
 * Usage:
 *   import { askAI } from '../services/aiProvider.js';
 *   const answer = await askAI('What is the capital of France?');
 */

import dotenv from 'dotenv';
dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY   = process.env.GROQ_API_KEY;

const GEMINI_MODEL  = process.env.GEMINI_MODEL  || 'gemini-3.8-flash';
const GROQ_MODEL    = process.env.GROQ_MODEL    || 'qwen/qwen3.8-27b';
const OLLAMA_MODEL  = process.env.OLLAMA_MODEL  || 'llama3.2';
const OLLAMA_URL    = process.env.OLLAMA_URL    || 'http://localhost:11434';

// Provider: Google Gemini Flash
async function askGemini(prompt) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 512 }
    }),
    signal: AbortSignal.timeout(20000)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Gemini HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty response');
  return text.trim();
}

// Provider: Groq (OpenAI-compatible API)
async function askGroq(prompt) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not set');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 512
    }),
    signal: AbortSignal.timeout(20000)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Groq HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Groq returned empty response');
  return text.trim();
}

// Provider: Ollama (local, CPU-based fallback)
async function askOllama(prompt) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.2, num_predict: 512 }
    }),
    signal: AbortSignal.timeout(90000)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Ollama HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data?.response;
  if (!text) throw new Error('Ollama returned empty response');
  return text.trim();
}

/**
 * Ask a question with automatic provider failover.
 * Chain: Gemini Flash -> Groq -> Ollama (local).
 *
 * @param {string} prompt
 * @param {{ verbose?: boolean }} options
 * @returns {Promise<string>}
 */
export async function askAI(prompt, { verbose = false } = {}) {
  const providers = [
    { name: 'Gemini Flash',   fn: askGemini },
    { name: 'Groq Llama-3',   fn: askGroq   },
    { name: 'Ollama (local)', fn: askOllama }
  ];

  let lastError;
  for (const { name, fn } of providers) {
    try {
      if (verbose) console.log(`[AIProvider] Trying ${name}...`);
      const answer = await fn(prompt);
      if (verbose) console.log(`[AIProvider] SUCCESS ${name} responded.`);
      return answer;
    } catch (err) {
      lastError = err;
      console.warn(`[AIProvider] WARN ${name} failed: ${err.message}`);
    }
  }

  throw new Error(`All AI providers failed. Last error: ${lastError?.message}`);
}

/**
 * Returns which providers are currently configured.
 */
export function getProviderStatus() {
  return {
    gemini: !!GEMINI_API_KEY,
    groq:   !!GROQ_API_KEY,
    ollama: true
  };
}
