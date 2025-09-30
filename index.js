#!/usr/bin/env node
import figlet from 'figlet';
import { pastel } from 'gradient-string';
import { scanProject } from './src/scanner.js';

async function main() {
    startMsg();

    const argv = process.argv.slice(2);
    const cmd = argv[0];


    if (cmd === 'scan') {
        const rest = argv.slice(1);
        const showAll = rest.includes('--all');
        const showNew = rest.includes('--new');
        const showWarnings = rest.includes('--warnings') || rest.includes('-w');
        const summary = rest.includes('--summary') || rest.includes('-s');
        const limitIdx = rest.findIndex(x => x === '--limit');
        let limit = 50; // default reduce noise
        if (limitIdx !== -1 && rest[limitIdx + 1]) {
            const v = parseInt(rest[limitIdx + 1], 10);
            if (!Number.isNaN(v) && v > 0) limit = v;
        }
        const patterns = rest.filter(x => !x.startsWith('-'));

        const reportByFile = await scanProject(patterns.length ? patterns : undefined);
        const files = Object.keys(reportByFile).sort();

        const pick = (entry) => {
            if (showAll) return true;
            if (showWarnings) return entry.status?.baseline === false || entry.status?.baseline === 'low';
            if (showNew) return entry.status?.baseline === 'low';
            return entry.status?.baseline === false; // default: only risky
        };

        if (summary) {
            // compute counts across files
            let total = 0, high = 0, low = 0, none = 0;
            for (const file of files) {
                for (const f of reportByFile[file]) {
                    if (!pick(f)) continue;
                    total++;
                    const s = f.status?.baseline;
                    if (s === 'high') high++;
                    else if (s === 'low') low++;
                    else none++;
                }
            }
            console.log('Summary:');
            console.log(`- ✅ ${high} widely available features`);
            console.log(`- 🟡 ${low} newly available features`);
            console.log(`- ❌ ${none} not in baseline`);
            const score = total === 0 ? 100 : Math.round(((high + low * 0.5) / total) * 100);
            console.log(`Baseline Score: ${score}%`);
            return;
        }

        // build and print detailed per-file table
        const lines = [];
        let total = 0, high = 0, low = 0, none = 0;
        for (const file of files) {
            const feats = reportByFile[file].filter(pick);
            if (feats.length === 0) continue;
            lines.push(`\nFile: ${file}`);
            lines.push('─────────────────────────────────────────────');
            lines.push(`Feature             Line Status      Support`);
            lines.push('─────────────────────────────────────────────');
            for (const f of feats.slice(0, limit)) {
                total++;
                const status = f.status?.baseline;
                if (status === 'high') high++;
                else if (status === 'low') low++;
                else none++;

                const emoji = status === 'high' ? '✅' : status === 'low' ? '🟡' : '❌';
                const support = status === 'high' ? `Baseline ${f.status?.baseline_high_date || ''}` : status === 'low' ? `Baseline ${f.status?.baseline_low_date || ''}` : (f.status?.support ? Object.keys(f.status.support).join(', ') : 'Expected: unknown');
                const name = (f.featureName || f.key).padEnd(18).slice(0, 18);
                const lineInfo = f.line ? f.line.toString().padEnd(4) : '    ';
                const statText = status === 'high' ? 'Widely' : status === 'low' ? 'Newly' : 'Not in';
                lines.push(`${name}  ${lineInfo} ${emoji} ${statText.padEnd(8)}  ${support}`);
            }
        }

        if (lines.length === 0) console.log('No findings. Use --all to list everything.');
        else console.log(['Baseline Check Report (Target: Baseline 2024)', ...lines].join('\n'));

        console.log('\nSummary:');
        console.log(`- ✅ ${high} widely available features`);
        console.log(`- 🟡 ${low} newly available features`);
        console.log(`- ❌ ${none} not in baseline`);
        const score = total === 0 ? 100 : Math.round(((high + low * 0.5) / total) * 100);
        console.log(`Baseline Score: ${score}%`);
        return;
    }

    console.log('Unknown command. Try: scan');
}

function startMsg() {
    console.clear();
    const startMsg = `Welcome     to \n Baseline   -   CLI`;
    figlet(startMsg, (err, data) => {
        // if (!err) console.log(pastel.multiline(data));
        if (!err) console.log(data);
    });
}

main();