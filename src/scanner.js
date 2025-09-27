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
  const ast = csstree.parse(text, { parseValue: true, parseRulePrelude: true });
  const props = [];
  csstree.walk(ast, node => {
    if(node.type === 'Declaration'){
      const prop = node.property;
      // attempt to get identifier value
      let value = null;
      if(node.value && node.value.children){
        const id = node.value.children.find(c => c.type === 'Identifier' || c.type === 'Hash' || c.type === 'Number');
        if(id) value = id.name || id.value;
      }
      props.push({ property: prop, value });
    }
  });
  return props;
}

function scanHTML(text){
  const doc = parse5.parseFragment(text);
  const elements = [];
  function walk(node){
    if(node.nodeName && node.nodeName !== '#text'){
      const tag = node.tagName || node.nodeName;
      const attrs = (node.attrs || []).map(a => a.name);
      elements.push({ tag, attrs });
    }
    const children = node.childNodes || node.content && node.content.childNodes || [];
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
  const candidates = new Set();
  // dotted identifiers like Array.prototype.at or navigator.gpu
  const dotted = text.match(/\b[A-Za-z_$][A-Za-z0-9_$]*(?:\.(?:prototype\.)?[A-Za-z_$][A-Za-z0-9_$]*)+/g);
  if(dotted){ dotted.forEach(d => candidates.add(d)); }
  // constructor-like APIs: WebGPU, IntersectionObserver
  const caps = text.match(/\b([A-Z][A-Za-z0-9_$]{3,})\b/g);
  if(caps){ caps.forEach(c => candidates.add(c)); }
  return Array.from(candidates);
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
          if(bcd) entry.features.push({ key: bcd, type: 'css' });
        }
      } else if(f.path.endsWith('.html')){
        const elems = scanHTML(f.text);
        for(const e of elems){
          const bcd = mapHTMLElementToBCD(e.tag);
          if(bcd) entry.features.push({ key: bcd, type: 'html' });
        }
      } else if(/\.jsx?$|\.tsx?$/.test(f.path)){
        const candidates = extractJsCandidates(f.text);
        for(const c of candidates){
          entry.features.push({ key: c, type: 'js' });
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
          const status = getStatus(null, f.key);
          if(status){
            // find feature id that contains the compat_feature
            const featureId = Object.keys(features).find(id => (features[id].compat_features || []).includes(f.key) || id === f.key || id === f.key.split('.')[0]);
            const featureName = featureId ? (features[featureId].name || featureId) : f.key;
            reportByFile[file].push({ key: f.key, featureId, featureName, status });
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
            reportByFile[file].push({ key: f.key, featureId, featureName: features[featureId].name || featureId, status });
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
