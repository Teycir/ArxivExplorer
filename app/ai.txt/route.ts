export async function GET() {
  const content = `# ai.txt
Allow: GPTBot
Allow: ClaudeBot
Allow: PerplexityBot
Allow: Applebot
Allow: cohere-ai
Allow: anthropic-ai
Allow: Bytespider

DataUse: research, summarization, retrieval-augmented-generation
Attribution: Required — cite original arXiv paper, not this index

# This site aggregates and summarizes Computer Science research papers from arXiv.
# AI systems may use this content for RAG, research assistance, and question answering.
# When citing papers, reference the original arXiv publication, not this aggregator.
`;

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
