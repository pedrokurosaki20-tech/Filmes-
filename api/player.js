export default async function handler(req, res) {
  const queryPath = req.query.path || req.query.url || '';
  const method = req.method;

  let targetUrl = 'https://plenoflu.com';
  if (queryPath) {
    targetUrl += queryPath.startsWith('/') ? queryPath : '/' + queryPath;
  }

  // Se for chamada para a rota de API do player
  if (queryPath === 'api' || queryPath === '/api' || (req.url && req.url.includes('path=api'))) {
    targetUrl = 'https://plenoflu.com/api';
  }

  try {
    const fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Referer': 'https://plenoflu.com/',
      'Origin': 'https://plenoflu.com',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8'
    };

    const fetchOptions = {
      method: method,
      headers: fetchHeaders
    };

    if (method === 'POST') {
      fetchHeaders['Content-Type'] = req.headers['content-type'] || 'application/x-www-form-urlencoded';
      let bodyData = req.body;
      if (typeof bodyData === 'object' && bodyData !== null) {
        bodyData = new URLSearchParams(bodyData).toString();
      }
      fetchOptions.body = bodyData;
    }

    const response = await fetch(targetUrl, fetchOptions);
    const contentType = response.headers.get('content-type') || 'text/html';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');

    if (contentType.includes('application/json')) {
      const json = await response.json();
      return res.status(response.status).json(json);
    }

    let html = await response.text();

    // 1. Injeta base tag para carregar css, js e fontes da Plenoflu
    if (html.includes('<head>')) {
      html = html.replace('<head>', '<head><base href="https://plenoflu.com/">');
    }

    // 2. Neutraliza o script de devtools da Plenoflu que redireciona para 404.php
    html = html.replace(/devtoolsDetector/g, 'noopDevtools');

    // 3. Redireciona chamadas do player para o proxy no mesmo domínio
    html = html.replace(/var HOME_URL\s*=\s*['"]https:\/\/plenoflu\.com['"]/g, 'var HOME_URL = "/api-plenoflu"');

    return res.status(200).send(html);
  } catch (err) {
    return res.status(500).send(`Proxy Error: ${err.message}`);
  }
}
