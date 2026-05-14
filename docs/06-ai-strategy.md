# 06 — AI Strategy

## 1. Principles

1. **AI proposes, human approves.** No AI output mutates the books or files anything to Coretax. Every suggestion is reviewed.
2. **Every AI output is cited.** RAG answers cite PMK/PER/UU passages. Journal suggestions cite the template and rule rows used.
3. **Provider-agnostic.** A single `LLMProvider` port; OpenAI / Gemini / Claude are pluggable adapters. Tenants may pin a provider for data-residency reasons.
4. **AI is a domain module**, not a wrapper around a chat API. It has its own RBAC, audit, rate limits, cost accounting.
5. **PII redaction at the boundary.** NPWP/NIK/salary numbers are pseudonymized before leaving our infra unless the tenant opted in.
6. **Cost is a first-class metric.** Every call records tokens-in/out, latency, model, prompt version → per-tenant billing & cost guardrails.

## 2. Capabilities (MVP scope)

| Capability | Input | Output | Risk class |
|---|---|---|---|
| **Invoice OCR** | PDF/image of faktur or kuitansi | structured fields (NPWP, DPP, PPN, lines, kode transaksi) | medium |
| **Journal suggestion** | NL description ("bayar listrik PLN 2.5jt") | candidate journal lines via template engine | medium |
| **Tax Q&A (RAG)** | NL question | answer + citations to peraturan | low (no mutation) |
| **Compliance scan** | tenant's last 90 days | list of issues (missing bukti potong, unfiled SPT, PPN tidak balance) | low |
| **Transaction classification** | bank statement line | suggested account + tax treatment | medium |
| **Anomaly detection** | journal stream | flagged outliers (round-number bias, weekend posting, duplicate) | low |

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ modules/ai                                                       │
│                                                                  │
│  application/                                                    │
│   ─ AskTaxQuestion       ─ SuggestJournalFromText               │
│   ─ ExtractInvoiceFields ─ ScanCompliance                       │
│   ─ ClassifyBankLine     ─ DetectAnomalies                      │
│                                                                  │
│  domain/                                                         │
│   ─ Conversation, Suggestion (aggregates)                        │
│   ─ Citation (value object — must point to a real ai_document)   │
│   ─ Guardrail (interface)                                        │
│                                                                  │
│  infrastructure/                                                 │
│   ─ ports/LLMProvider                                            │
│       ├─ adapters/OpenAIAdapter                                  │
│       ├─ adapters/GeminiAdapter                                  │
│       └─ adapters/ClaudeAdapter                                  │
│   ─ ports/OCRProvider                                            │
│       ├─ adapters/TextractAdapter                                │
│       ├─ adapters/DocumentAIAdapter                              │
│       └─ adapters/TesseractFallback                              │
│   ─ rag/                                                         │
│       ├─ Embedder (model-agnostic)                               │
│       ├─ Retriever (pgvector hybrid: dense + BM25)               │
│       └─ Reranker (optional cross-encoder)                       │
│   ─ guardrails/                                                  │
│       ├─ PiiRedactor (NPWP/NIK/salary patterns)                  │
│       ├─ JsonSchemaValidator (LLM output → strict schema)        │
│       ├─ JournalValidator   (must balance; accounts must exist)  │
│       └─ CitationValidator  (every claim must cite ai_documents) │
│                                                                  │
│  interface/                                                      │
│   ─ http (REST)  ─ ws (streaming chat)  ─ queue consumers        │
└──────────────────────────────────────────────────────────────────┘
```

## 4. RAG corpus: peraturan-as-data

We maintain a curated corpus, ingested into `ai_documents`:

- **UU**: UU 7/2021 (HPP), UU 6/1983 (KUP), UU 36/2008 (PPh), UU 42/2009 (PPN)…
- **PP**: PP 55/2022 (PPh Final UMKM)…
- **PMK**: PMK 168/2023 (PPh 21 TER), PMK 131/2024 (PPN 12% & nilai lain), PMK 141/2015 (jasa lain)…
- **PER DJP**: format faktur, kode objek pajak, prosedur Coretax…
- **SE DJP**: surat edaran teknis…

Ingestion pipeline:
1. PDF → OCR + structured chunker (preserves pasal/ayat hierarchy).
2. Each chunk gets `citation` like `"PMK 168/2023 ps. 5 ayat 2"`.
3. Embed with the configured embedding model.
4. Upsert into `ai_documents`.

Retrieval: **hybrid** (BM25 over `content` + cosine over `embedding`) → top-K → rerank → assemble prompt.

## 5. Prompting & guardrails

### 5.1 Strict output schemas

Every LLM call uses **structured output** (JSON schema / function calling). The response is validated by `JsonSchemaValidator`. If invalid, retry with the validator's diff appended; after N retries, fail loudly — never silently produce free-text into a journal.

### 5.2 Citation enforcement

For tax Q&A, the prompt requires the model to return:

```json
{
  "answer": "...",
  "citations": [
    { "doc_id": "uuid", "passage": "...", "score": 0.83 }
  ]
}
```

`CitationValidator` checks:
- Each `doc_id` exists in `ai_documents`.
- Each `passage` is a substring of the document chunk it cites (no hallucinated quotes).
- At least one citation when the answer claims a number/rate/deadline.

If validation fails → answer is shown with a banner "Tidak ditemukan dasar regulasi yang valid; jawab manual" and routed to a human-review queue.

### 5.3 PII redaction

Before any payload leaves our infra (unless tenant opted in to "send raw"):

- NPWP `\d{15,16}` → `<NPWP>`
- NIK `\d{16}` → `<NIK>`
- bank account `\d{10,16}` → `<ACCT>`
- salary numbers near `gaji|bruto|tunjangan` → `<AMT>`

The redacted-vs-raw mapping is stored locally for un-redaction of responses.

### 5.4 Tool use, not free-form generation

Journal suggestion does **not** ask the LLM to write JSON journal lines from scratch. It asks the LLM to **pick a `TransactionTemplate` and provide its inputs**. The template engine then produces the actual journal. This contains the blast radius of a hallucination to "wrong template chosen" (correctable) instead of "fabricated debit/credit" (corrupting).

## 6. Provider abstraction

```ts
interface LLMProvider {
  name: string;
  chat(req: ChatRequest): Promise<ChatResponse>;       // structured output
  embed(texts: string[]): Promise<number[][]>;
}

interface OCRProvider {
  name: string;
  extractInvoice(file: Buffer, mime: string): Promise<RawOcrResult>;
}
```

Selection is per-tenant via `tenant_settings.aiProvider`. Default is OpenAI; enterprise tenants on Indonesian sovereign data can pin Gemini-on-Vertex-Indonesia or a self-hosted model later.

Each provider adapter:
- Maps our schema-aware request to the provider's native format.
- Handles retries / rate limiting / token accounting.
- Emits `AiCallCompleted` event for cost analytics.

## 7. Cost & quotas

`ai_calls` table records every call (tokens, model, latency, cost USD/IDR). Per-tenant monthly quota enforced in `AIRateLimitGuard`. Soft limit → warning banner; hard limit → endpoint returns 429.

## 8. Audit & explainability

Every accepted AI suggestion creates:
- `ai_suggestions` row with `input`, `output`, `citations`, `model`, `prompt_version`, `status='ACCEPTED'`.
- `audit_events` row with `actor_kind='AI'`, `action='ai.suggest.accept'`, the user who confirmed, before/after.

Six months later, an auditor can reconstruct: "this journal was posted because the AI suggested template X based on these citations, reviewed by user Y at timestamp Z, using prompt version P and model M."

## 9. What we explicitly do NOT do

- ❌ Auto-post anything from AI without human accept.
- ❌ Send tenant data to a model whose provider has not signed a DPA.
- ❌ Use AI to choose tax rates. Rates come from `tax_rules`, full stop.
- ❌ Train on tenant data without explicit opt-in (UU PDP).
- ❌ Display an AI answer without a "regenerate / dispute / cite source" affordance.
