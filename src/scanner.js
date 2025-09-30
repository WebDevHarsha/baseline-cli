import fg from 'fast-glob';
import fs from 'fs/promises';
import * as csstree from 'css-tree';
import * as parse5 from 'parse5';
import { getStatus } from 'compute-baseline';
import { features } from 'web-features';

function unique(arr){
  return Array.from(new Set(arr));
}

async function readFiles(patterns){
  const pats = patterns && patterns.length ? patterns : ['**/*.{html,css,js,jsx,ts,tsx}'];
  const paths = await fg(pats, { dot: true, ignore: ['**/node_modules/**', '**/dist/**', '.git/**'] });
  const results = [];
  for(const p of paths){
    try{
      const text = await fs.readFile(p, 'utf8');
      results.push({ path: p, text });
    }catch(e){/* ignore */}
  }
  return results;
}

function scanCSS(text){
  const ast = csstree.parse(text, { parseValue: true, parseRulePrelude: true, positions: true });
  const props = [];
  csstree.walk(ast, node => {
    if (node.type === 'Declaration') {
      const prop = node.property;
      // generate a textual value for more accurate mapping (handles functions, identifiers, hyphens)
      let value = null;
      try {
        if (node.value) {
          value = csstree.generate(node.value).trim();
          // if value is wrapped (e.g. "url(...)"), keep inner token where possible
          if (value === '') value = null;
        }
      } catch (e) {
        // fallback to the previous simple approach
        if (node.value && node.value.children) {
          const id = node.value.children.find(c => c.type === 'Identifier' || c.type === 'Hash' || c.type === 'Number');
          if (id) value = id.name || id.value;
        }
      }

      // Get line number from AST position
      const line = node.loc?.start?.line || null;
      props.push({ property: prop, value, line });
    }
  });
  return props;
}

function scanHTML(text){
  // parse full documents and fragments (works for both)
  let doc;
  try {
    doc = parse5.parse(text);
  } catch (e) {
    doc = parse5.parseFragment(text);
  }

  const elements = [];
  const lines = text.split('\n');
  
  function getLineFromOffset(offset) {
    if (!offset) return null;
    let currentOffset = 0;
    for (let i = 0; i < lines.length; i++) {
      const lineLength = lines[i].length + 1; // +1 for newline
      if (currentOffset + lineLength > offset) {
        return i + 1;
      }
      currentOffset += lineLength;
    }
    return null;
  }
  
  function walk(node){
    if(!node) return;
    if(node.nodeName && node.nodeName !== '#text'){
      const tag = node.tagName || node.nodeName;
      const attrs = (node.attrs || []).map(a => ({ name: a.name, value: a.value }));
      const line = node.sourceCodeLocation ? getLineFromOffset(node.sourceCodeLocation.startOffset) : null;
      elements.push({ tag, attrs, line });
    }

    // collect inline script text as js candidates and inline styles
    if (node.tagName === 'script' && node.childNodes) {
      for (const c of node.childNodes) {
        if (c.nodeName === '#text' && c.value) {
          const line = c.sourceCodeLocation ? getLineFromOffset(c.sourceCodeLocation.startOffset) : null;
          elements.push({ tag: 'script', script: c.value, line });
        }
      }
    }

    const children = node.childNodes || (node.content && node.content.childNodes) || [];
    for(const c of children) walk(c);
  }

  for(const c of doc.childNodes || []) walk(c);
  return elements;
}

function mapCSSPropToBCD(property, value){
  const base = `css.properties.${property}`;
  if(value) return `${base}.${value}`;
  return base;
}

function mapHTMLElementToBCD(tag){
  return `html.elements.${tag}`;
}

function extractJsCandidates(text){
  const candidates = [];
  const lines = text.split('\n');
  
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const lineNum = lineIndex + 1;
    
    // dotted identifiers like Array.prototype.at or navigator.gpu
    const dottedRegex = /\b[A-Za-z_$][A-Za-z0-9_$]*(?:\.(?:prototype\.)?[A-Za-z_$][A-Za-z0-9_$]*)+/g;
    let match;
    while ((match = dottedRegex.exec(line)) !== null) {
      candidates.push({ candidate: match[0], line: lineNum });
    }
    
    // constructor-like APIs: WebGPU, IntersectionObserver
    const capsRegex = /\b([A-Z][A-Za-z0-9_$]{3,})\b/g;
    while ((match = capsRegex.exec(line)) !== null) {
      candidates.push({ candidate: match[1], line: lineNum });
    }
  }
  
  // Remove duplicates while preserving line info (keep first occurrence)
  const seen = new Set();
  return candidates.filter(item => {
    if (seen.has(item.candidate)) return false;
    seen.add(item.candidate);
    return true;
  });
}

export async function scanProject(rootPatterns){
  const files = await readFiles(rootPatterns);
  const byFile = {};

  for(const f of files){
    const entry = { path: f.path, features: [] };
    try{
      if(f.path.endsWith('.css')){
        const props = scanCSS(f.text);
        for(const p of props){
          const bcd = mapCSSPropToBCD(p.property, p.value);
          if(bcd) entry.features.push({ key: bcd, type: 'css', line: p.line });
        }
      } else if(f.path.endsWith('.html')){
        const elems = scanHTML(f.text);
        for(const e of elems){
          // normal element tags
          if(e.tag && e.tag !== 'script'){
            const bcd = mapHTMLElementToBCD(e.tag);
            if(bcd) entry.features.push({ key: bcd, type: 'html', line: e.line });

            // check inline style attribute
            const styleAttr = (e.attrs || []).find(a => a.name === 'style');
            if (styleAttr && styleAttr.value) {
              // parse inline declarations by wrapping in a rule
              try {
                const inlineProps = scanCSS(`x{${styleAttr.value}}`);
                for (const p of inlineProps) {
                  const bcd = mapCSSPropToBCD(p.property, p.value);
                  if (bcd) entry.features.push({ key: bcd, type: 'css', line: e.line });
                }
              } catch (err) { /* ignore */ }
            }
          }

          // inline script content
          if(e.tag === 'script' && e.script){
            const candidates = extractJsCandidates(e.script);
            for(const c of candidates) entry.features.push({ key: c.candidate, type: 'js', line: e.line });
          }
        }
      } else if(/\.jsx?$|\.tsx?$/.test(f.path)){
        const candidates = extractJsCandidates(f.text);
        for(const c of candidates){
          entry.features.push({ key: c.candidate, type: 'js', line: c.line });
        }
      }
    }catch(e){ /* ignore file parse errors */ }

    // dedupe
    entry.features = unique(entry.features.map(s => JSON.stringify(s))).map(s => JSON.parse(s));
    if(entry.features.length) byFile[f.path] = entry.features;
  }

  // enrich per-file features with baseline status and feature names
  const reportByFile = {};
  for(const [file, feats] of Object.entries(byFile)){
    reportByFile[file] = [];
    for(const f of feats){
      try{
        if(f.type === 'css' || f.type === 'html'){
          // try full BCD key first, then fallback to parent (property) key
          let status = null;
          try {
            status = getStatus(null, f.key);
          } catch (err) {
            // compute-baseline may throw for unindexable/unknown bcd keys; treat as not found and try fallbacks
            status = null;
          }
          let usedKey = f.key;
          if(!status && f.key.includes('.')){
            const parts = f.key.split('.');
            // drop the last segment and try again (e.g. css.properties.prop.value -> css.properties.prop)
            const parentKey = parts.slice(0, -1).join('.');
            try {
              status = getStatus(null, parentKey);
            } catch (err) {
              status = null;
            }
            if(status) usedKey = parentKey;
          }

          // if still not found, try to locate a feature that lists this compat key and use its status
          if(!status){
            const featureId = Object.keys(features).find(id => (features[id].compat_features || []).includes(f.key));
            if(featureId && features[featureId].status) {
              status = features[featureId].status;
              usedKey = features[featureId].compat_features && features[featureId].compat_features[0] || usedKey;
            }
          }

          if(status){
            // find feature id that contains the compat_feature (prefer exact mapping)
            const featureId = Object.keys(features).find(id => (features[id].compat_features || []).includes(usedKey) || id === usedKey || id === usedKey.split('.')[0]);
            const featureName = featureId ? (features[featureId].name || featureId) : usedKey;
            reportByFile[file].push({ key: usedKey, featureId, featureName, status, line: f.line });
          } else {
            // skip unmapped css/html keys
            continue;
          }
        } else if(f.type === 'js'){
          // try to map JS candidate to a feature
          const candidate = maybeFromApi(f.key);
          const featureId = Object.keys(features).find(id => id.toLowerCase().includes(candidate) || (features[id].name || '').toLowerCase().includes(candidate) || (features[id].compat_features || []).some(k => k.toLowerCase().includes(candidate)));
          if(featureId){
            const status = features[featureId].status || { baseline: false };
            reportByFile[file].push({ key: f.key, featureId, featureName: features[featureId].name || featureId, status, line: f.line });
          } else {
            // skip unmapped JS candidates
            continue;
          }
        }
      }catch(e){
        // ignore parse/enrich errors and skip
        continue;
      }
    }
  }

  return reportByFile;
}

function maybeFromApi(apiKey){
  return apiKey.replace(/^api\./, '').toLowerCase();
}
