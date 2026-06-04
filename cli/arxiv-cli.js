#!/usr/bin/env node
"use strict";
/**
 * arxiv-cli.ts
 * CLI tool for AI assistants (Claude, ChatGPT, etc.) to search and explore papers
 *
 * Usage:
 *   arxiv-cli search "transformer attention"
 *   arxiv-cli paper 2605.30353
 *   arxiv-cli trending --limit 5
 *   arxiv-cli topic large-language-models
 *   arxiv-cli author "Yann LeCun"
 */
Object.defineProperty(exports, "__esModule", { value: true });
const API_BASE = process.env.ARXIV_API_BASE || 'https://arxiv-api.arxivexplorer.workers.dev';
async function fetch_api(endpoint) {
    const res = await fetch(`${API_BASE}${endpoint}`);
    if (!res.ok)
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json();
}
function format_paper(paper, verbose = false) {
    const lines = [
        `ID: ${paper.id}`,
        `Title: ${paper.title}`,
        `Authors: ${paper.authors.slice(0, 3).join(', ')}${paper.authors.length > 3 ? '...' : ''}`,
        `Published: ${paper.publishedAt.split('T')[0]}`,
        `Categories: ${paper.categories.join(', ')}`,
    ];
    if (paper.summary?.tldr) {
        lines.push(`TL;DR: ${paper.summary.tldr}`);
    }
    if (verbose && paper.summary) {
        if (paper.summary.paperType)
            lines.push(`Type: ${paper.summary.paperType}`);
        if (paper.summary.keywords)
            lines.push(`Keywords: ${paper.summary.keywords.join(', ')}`);
    }
    lines.push(`URL: https://arxiv.org/abs/${paper.id}`);
    return lines.join('\n');
}
async function cmd_search(query, opts = {}) {
    const params = new URLSearchParams({ q: query });
    if (opts.limit)
        params.set('limit', opts.limit);
    if (opts.category)
        params.set('category', opts.category);
    if (opts.author)
        params.set('author', opts.author);
    const data = await fetch_api(`/api/search?${params}`);
    console.log(`Found ${data.papers.length} papers:\n`);
    data.papers.forEach((p, i) => {
        console.log(`[${i + 1}] ${format_paper(p)}\n`);
    });
}
async function cmd_paper(id) {
    const data = await fetch_api(`/api/paper/${id}`);
    console.log(format_paper(data, true));
    if (data.summary) {
        console.log('\n--- AI Summary ---');
        console.log(`TL;DR: ${data.summary.tldr}`);
        console.log(`\nKey Contributions:\n${data.summary.keyContributions.map((k) => `- ${k}`).join('\n')}`);
        console.log(`\nMethods:\n${data.summary.methods.map((m) => `- ${m}`).join('\n')}`);
        if (data.summary.prerequisites?.length) {
            console.log(`\nPrerequisites:\n${data.summary.prerequisites.map((p) => `- ${p}`).join('\n')}`);
        }
    }
}
async function cmd_trending(limit = 10) {
    const data = await fetch_api(`/api/trending?limit=${limit}`);
    console.log(`Trending papers (${data.papers.length}):\n`);
    data.papers.forEach((p, i) => {
        console.log(`[${i + 1}] ${format_paper(p)}\n`);
    });
}
async function cmd_topic(slug, limit = 10) {
    const data = await fetch_api(`/api/topic/${slug}?limit=${limit}`);
    console.log(`Topic: ${slug} (${data.papers.length} papers)\n`);
    data.papers.forEach((p, i) => {
        console.log(`[${i + 1}] ${format_paper(p)}\n`);
    });
}
async function cmd_author(name, limit = 10) {
    const data = await fetch_api(`/api/author/${encodeURIComponent(name)}?limit=${limit}`);
    console.log(`Author: ${name}`);
    console.log(`Papers: ${data.totalPapers}`);
    if (data.totalCitations)
        console.log(`Citations: ${data.totalCitations}`);
    console.log(`\nRecent papers (${data.papers.length}):\n`);
    data.papers.forEach((p, i) => {
        console.log(`[${i + 1}] ${format_paper(p)}\n`);
    });
}
async function cmd_topics() {
    const data = await fetch_api('/api/topics');
    console.log(`Available topics (${data.topics.length}):\n`);
    data.topics.forEach((t) => {
        console.log(`- ${t.slug} (${t.paperCount} papers)`);
    });
}
async function main() {
    const args = process.argv.slice(2);
    const cmd = args[0];
    try {
        switch (cmd) {
            case 'search':
                await cmd_search(args[1], { limit: args[2] });
                break;
            case 'paper':
                await cmd_paper(args[1]);
                break;
            case 'trending':
                await cmd_trending(parseInt(args[1]) || 10);
                break;
            case 'topic':
                await cmd_topic(args[1], parseInt(args[2]) || 10);
                break;
            case 'author':
                await cmd_author(args[1], parseInt(args[2]) || 10);
                break;
            case 'topics':
                await cmd_topics();
                break;
            default:
                console.log(`ArxivExplorer CLI - AI Assistant Tool

Usage:
  arxiv-cli search <query> [limit]        Search papers
  arxiv-cli paper <arxiv-id>              Get paper details with AI summary
  arxiv-cli trending [limit]              Show trending papers
  arxiv-cli topic <slug> [limit]          Papers by topic
  arxiv-cli author <name> [limit]         Papers by author
  arxiv-cli topics                        List all topics

Examples:
  arxiv-cli search "transformer attention" 5
  arxiv-cli paper 2605.30353
  arxiv-cli trending 10
  arxiv-cli topic large-language-models
  arxiv-cli author "Yann LeCun"

Environment:
  ARXIV_API_BASE   API endpoint (default: https://arxiv-api.arxivexplorer.workers.dev)
`);
        }
    }
    catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
}
main();
