import { localAppURL } from './public/local-url.mjs';

function permitsAncestor(value, target, ancestor) {
  const rules = value.toLowerCase().split(/\s+/);
  return rules.some(rule => {
    if (rule === '*') return true;
    if (rule === "'self'") return target.origin === ancestor.origin;
    if (/^https?:$/.test(rule)) return rule === ancestor.protocol;
    if (rule.startsWith("'") || !rule) return false;
    try {
      const anyPort = /:\*(?:\/|$)/.test(rule);
      const normalized = rule.replace(/:\*(?=\/|$)/, ':0').replace(/^\*:\/\//, ancestor.protocol + '//');
      const source = new URL(normalized.includes('://') ? normalized : target.protocol + '//' + normalized);
      const host = source.hostname;
      return source.protocol === ancestor.protocol &&
        (host === ancestor.hostname || host.startsWith('*.') && ancestor.hostname.endsWith(host.slice(1))) &&
        (anyPort || (source.port || (source.protocol === 'https:' ? '443' : '80')) === (ancestor.port || (ancestor.protocol === 'https:' ? '443' : '80')));
    } catch { return false; }
  });
}

export function embeddingBlocked(headers, targetURL, parentURL) {
  const target = new URL(targetURL), ancestor = new URL(parentURL);
  const policies = (headers.get('content-security-policy') || '').split(',');
  let ancestors = false;
  for (const policy of policies) {
    const directive = policy.split(';').map(part => part.trim()).find(part => /^frame-ancestors(?:\s|$)/i.test(part));
    if (!directive) continue;
    ancestors = true;
    if (!permitsAncestor(directive.replace(/^frame-ancestors\s*/i,''), target, ancestor)) return true;
  }
  // Enforced frame-ancestors takes precedence over X-Frame-Options.
  if (ancestors) return false;
  const options = headers.get('x-frame-options') || '';
  return /deny/i.test(options) || /sameorigin/i.test(options) && target.origin !== ancestor.origin;
}

export async function localAppStatus(value, parentURL, discover, fetcher = fetch) {
  const url = typeof value === 'string' && value.length <= 8192 && localAppURL(value, parentURL);
  if (!url) throw new Error('Choose an HCB app on localhost.');
  const target = new URL(url);
  const observation = await discover({fresh:true});
  const server = observation.servers.find(server => server.port === Number(target.port || (target.protocol === 'https:' ? 443 : 80)) && !server.internal && !server.application && server.process !== 'hot-cross-buns-runtime');
  if (!server) return {state:'unavailable',message:'This app is no longer running under HCB. Start it through HCB, or open the address in your browser.'};
  try {
    const response = await fetcher(url,{method:'HEAD',redirect:'manual',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(2000)});
    if (response.status >= 300 && response.status < 400) return {state:'external',message:'This app redirects to another address. Open it in your browser to continue.'};
    if (embeddingBlocked(response.headers,url,parentURL)) return {state:'external',message:'This app blocks embedded previews. Open it in your browser to continue.'};
    if (response.status >= 400 && response.status !== 405) return {state:'unavailable',message:`This app returned HTTP ${response.status} for this address. Try reloading, or open it in your browser.`};
    return {state:'ready'};
  } catch {
    return {state:'unavailable',message:'This app is not responding. It may have stopped or still be starting. Try reloading the preview.'};
  }
}
