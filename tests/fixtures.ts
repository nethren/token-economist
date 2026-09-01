/** A deliberately bloated prompt exercising every linter rule. */
export const BLOATED_PROMPT = `You are a customer support ticket classifier for Acme Cloud.

It is important to note that you must classify each incoming support ticket into exactly one category. Please ensure that you read the entire ticket before deciding. Please note that you should always respond with valid JSON in order to make the output machine-readable.

You must classify each incoming support ticket into exactly one category from the list below, reading carefully.
Please make sure to read the entire ticket before deciding on a category, thanks.



Categories: billing, technical, account, sales, abuse, other.

It is important to note that you must classify each incoming support ticket into exactly one category. Please ensure that you read the entire ticket before deciding. Please note that you should always respond with valid JSON in order to make the output machine-readable.

--------------------------------------------------------------

## Example 1
Input: "I was charged twice for my subscription this month and I want a refund."
Output: {"category": "billing", "confidence": "high", "reasoning": "The customer mentions a duplicate charge and requests a refund, which is a billing matter."}

## Example 2
Input: "The API returns a 500 error whenever I upload a file larger than 10MB."
Output: {"category": "technical", "confidence": "high", "reasoning": "The customer reports a server-side error with file uploads, which is a technical issue."}

## Example 3
Input: "How do I reset my password? The reset email never arrives."
Output: {"category": "account", "confidence": "high", "reasoning": "Password reset and email delivery for account access are account issues."}

## Example 4
Input: "We're a 200-person company evaluating your enterprise plan, can someone call me?"
Output: {"category": "sales", "confidence": "high", "reasoning": "The customer is asking about enterprise plans and requesting sales contact."}

## Example 5
Input: "Someone is using your platform to send phishing emails impersonating our brand."
Output: {"category": "abuse", "confidence": "high", "reasoning": "The report concerns platform abuse via phishing, which is an abuse matter."}

Here is our full product catalog for reference, please use it when the ticket mentions a product, in order to identify the right team:

${Array.from({ length: 60 }, (_, i) => `- Product SKU-${1000 + i}: Acme ${["Compute", "Storage", "Database", "Queue", "Cache", "CDN"][i % 6]} tier ${(i % 5) + 1}, region ${["us-east", "eu-west", "ap-south"][i % 3]}, monthly price $${(i + 1) * 7}.99, support team ${["alpha", "bravo", "charlie"][i % 3]}`).join("\n")}

Please be aware that you should respond with the JSON object only. It is important to note that no prose should surround the JSON. Due to the fact that downstream systems parse your output automatically, kindly keep it strictly valid.
`;

/** A realistic RAG-style prompt: instructions + a large PROSE doc dump
 *  (Q&A/FAQ paragraphs, not bullets/JSON) that belongs in retrieval.
 *  Mirrors the PM test scenario that first exposed the detector gap. */
export const FAQ_DUMP_PROMPT =
  `You are Acme Cloud's documentation assistant. Answer developer questions about the Acme Cloud platform accurately and concisely, citing the relevant doc section. If you are not sure, say so and point to the support channel.

Here is the full Acme Cloud FAQ and API reference you should use to answer questions:

` +
  Array.from({ length: 80 }, (_, i) => {
    const noun = ["compute instance", "storage bucket", "database", "queue", "cache node", "CDN endpoint", "API key", "webhook"][i % 8];
    const verb = ["configure", "rotate", "delete", "list", "create", "monitor", "scale", "back up"][i % 8];
    const svc = ["compute", "storage", "db", "queue", "cache", "cdn", "auth", "hooks"][i % 8];
    return `Q${i + 1}: How do I ${verb} a ${noun}?\nA${i + 1}: Use the acme ${svc} command, or call the REST endpoint POST /v1/${svc}/{id}/action with a valid bearer token. See docs section ${i + 1}.2 for the full parameter list and rate limits, which vary by tier and region.`;
  }).join("\n\n");

/** Stable regression fixtures for the offline tokenizer. Counts pinned from
 *  gpt-tokenizer o200k_base — see tokenizer.test.ts. */
export const TOKEN_FIXTURES: Array<{ name: string; text: string }> = [
  { name: "empty", text: "" },
  { name: "hello", text: "hello world" },
  { name: "prose", text: "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs." },
  { name: "code", text: "function add(a: number, b: number): number {\n  return a + b;\n}\n" },
  { name: "unicode", text: "国境の長いトンネルを抜けると雪国であった。 Émigré café — naïve façade. 🚀🔥" },
  { name: "json", text: '{"category": "billing", "confidence": 0.92, "tags": ["refund", "duplicate-charge"]}' },
];
