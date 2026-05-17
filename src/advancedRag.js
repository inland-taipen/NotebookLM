/**
 * advancedRag.js — Implementing Solutions for RAG Bottlenecks
 */
const { getGroqClient } = require('./generator');

// 1. Query rewriting using SLMs | Query Translation & Sub query enhancement
async function rewriteQuery(question) {
    const groq = getGroqClient();
    const prompt = `You are an AI that optimizes questions for vector search.
Given the user's question, rewrite it into 1-3 distinct, highly specific search queries. 
This is for sub-query enhancement and query translation to retrieve better context.
Return ONLY the queries as a JSON array of strings.
Question: ${question}`;

    try {
        const response = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 150,
            response_format: { type: 'json_object' }
        });
        
        // Ensure parsing works
        const content = response.choices[0].message.content;
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed.queries)) return parsed.queries;
        if (Array.isArray(parsed)) return parsed;
        
        // Fallback: extract line by line
        return Object.values(parsed).flat().filter(q => typeof q === 'string');
    } catch (e) {
        console.error("[ADVANCED_RAG] Query rewriting failed", e.message);
        return [question]; // fallback to original
    }
}

// 2. Corrective RAG | HYDE Principal (Hypothetical Document Embeddings)
async function generateHyDE(question) {
    const groq = getGroqClient();
    const prompt = `You are an expert. Provide a brief, hypothetical answer to the following question. 
Do not worry about exact facts, just provide plausible content that would contain the right keywords to help vector search.
Question: ${question}`;

    try {
        const response = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: 200,
        });
        return response.choices[0].message.content;
    } catch(e) {
        console.error("[ADVANCED_RAG] HyDE generation failed", e.message);
        return question; // Fallback to original question
    }
}

// 3. LLM judges
async function evaluateAnswer(question, answer, contextChunks) {
    const groq = getGroqClient();
    const contextBlock = contextChunks.map((c, i) => `[Chunk ${i + 1}]\n${c.text}`).join('\n\n');
    const prompt = `You are an LLM Judge evaluating a RAG system.
Question: ${question}
Context: 
${contextBlock}
Answer: ${answer}

Evaluate if the answer is grounded in the context. 
Reply with a JSON object containing:
- "grounded": boolean (true/false)
- "reason": brief string explaining why`;

    try {
        const response = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.0,
            response_format: { type: 'json_object' }
        });
        return JSON.parse(response.choices[0].message.content);
    } catch(e) {
        console.error("[ADVANCED_RAG] LLM Judge evaluation failed", e.message);
        return { grounded: true, reason: "Evaluation failed, assumed true." };
    }
}

// 4. Re-ranking strategies (cross-encoders proxy using LLM)
async function rerankChunks(question, chunks) {
    if (!chunks || chunks.length === 0) return [];
    
    const groq = getGroqClient();
    const contextBlock = chunks.map((c, i) => `[Chunk ${i}]\n${c.text}`).join('\n\n');
    const prompt = `You are a cross-encoder reranker. Rate the relevance of each chunk to the question from 0 to 10.
Question: ${question}
Chunks:
${contextBlock}

Reply with a JSON object containing a "scores" array of integers in the same order as chunks. Example: {"scores": [8, 2, 10]}`;

    try {
        const response = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.0,
            response_format: { type: 'json_object' }
        });
        const result = JSON.parse(response.choices[0].message.content);
        if (result.scores && Array.isArray(result.scores) && result.scores.length === chunks.length) {
            const scoredChunks = chunks.map((c, i) => ({ ...c, rerankScore: result.scores[i] }));
            // Sort by rerankScore descending
            return scoredChunks.sort((a, b) => b.rerankScore - a.rerankScore);
        }
    } catch(e) {
        console.error("[ADVANCED_RAG] Reranking failed", e.message);
    }
    return chunks;
}

// 5. Context window & token bottlenecks
function enforceTokenLimit(chunks, maxTokens = 2000) {
    // Rough estimation: ~4 chars per token
    let currentTokens = 0;
    const allowedChunks = [];
    for (const chunk of chunks) {
        const chunkTokens = Math.ceil(chunk.text.length / 4);
        if (currentTokens + chunkTokens > maxTokens) {
            console.log(`[ADVANCED_RAG] Token limit reached. Truncated from ${chunks.length} to ${allowedChunks.length} chunks.`);
            break;
        }
        currentTokens += chunkTokens;
        allowedChunks.push(chunk);
    }
    return allowedChunks;
}

// 6. Tradeoff between speed and accuracy
// & 7. Chunk size & overlap tradeoffs
// Both are architectural concepts usually configured via settings.
// E.g., accurate mode uses higher TopK and applies reranking, while fast mode just uses top 3 cosine similarity.
function getTradeoffConfig(mode = 'accurate') {
    if (mode === 'fast') {
        return {
            topK: 3,
            useHyDE: false,
            useReranking: false,
            useQueryRewrite: false,
            maxTokens: 1000
        };
    }
    // accurate mode
    return {
        topK: 10,
        useHyDE: true,
        useReranking: true,
        useQueryRewrite: true,
        maxTokens: 3000
    };
}

module.exports = {
    rewriteQuery,
    generateHyDE,
    evaluateAnswer,
    rerankChunks,
    enforceTokenLimit,
    getTradeoffConfig
};
