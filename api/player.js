export const config = {
  api: {
    bodyParser: false,
  },
};

// Utilitário para ler o stream bruto da requisição no ambiente Vercel
async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  // Configuração global de CORS e headers permissivos para o Canal 1 (Plenoflu)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.removeHeader('X-Frame-Options');
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('Content-Security-Policy-Report-Only');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const queryPath = req.query.path || req.query.url || '';
  const method = req.method;

  let targetUrl = 'https://plenoflu.com';
  if (queryPath.startsWith('proxy-vaiquecol')) {
    targetUrl = req.query.url ? decodeURIComponent(req.query.url) : 'https://vaiquecol.com';
  } else if (queryPath) {
    targetUrl += queryPath.startsWith('/') ? queryPath : '/' + queryPath;
  }

  // Identifica rota da API interna da Plenoflu
  const isApiRoute = queryPath === 'api' || queryPath === '/api' || (req.url && req.url.includes('path=api'));
  if (isApiRoute) {
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
      const rawBody = await getRawBody(req);
      fetchOptions.body = rawBody;
    }

    const response = await fetch(targetUrl, fetchOptions);
    const contentType = response.headers.get('content-type') || 'text/html';

    res.setHeader('Content-Type', contentType);

    // Resposta de API interna do SuperCDN (POST /api com getPlayer e video_id)
    if (contentType.includes('application/json') || isApiRoute) {
      const json = await response.json();
      if (json && json.data && json.data.video_url) {
        try {
          const rawUrl = Buffer.from(json.data.video_url, 'base64').toString('utf-8');
          // Canal 1: Se apontar para vaiquecol.com, roteia pelo proxy do Plenoflu para manter o Referer oficial
          if (rawUrl.includes('vaiquecol.com')) {
            const proxiedUrl = `/api-plenoflu/proxy-vaiquecol?url=${encodeURIComponent(rawUrl)}`;
            json.data.video_url = Buffer.from(proxiedUrl).toString('base64');
          }
        } catch (_) {
          // Mantém URL original caso ocorra falha de decodificação
        }
      }
      return res.status(response.status).json(json);
    }

    let html = await response.text();

    // 1. Desativa detector de devtools da Plenoflu
    html = html.replace(/devtoolsDetector/g, 'noopDevtools');

    // 2. Aponta chamadas da API interna do player para o proxy local/Vercel (elimina bloqueios de CORS)
    html = html.replace(/var HOME_URL\s*=\s*['"]https:\/\/plenoflu\.com['"]/g, 'var HOME_URL = "/api-plenoflu"');

    // 3. Garante que o iframe interno use referrerpolicy seguro e permissões completas de mídia
    html = html.replace(
      '<iframe allowfullscreen frameborder="0" src="${msg.data.video_url}"></iframe>',
      '<iframe allowfullscreen frameborder="0" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" src="${msg.data.video_url}" style="width:100%;height:100%;border:0;"></iframe>'
    );

    // 4. Injeta estilos para exibição direta em tela cheia do player selecionado e botão Voltar Aos Canais
    const playerStyles = `
    <style>
      .player_container.visible {
        top: 0 !important;
        z-index: 99 !important;
        display: block !important;
        width: 100% !important;
        height: 100% !important;
        background: #000 !important;
      }
      .players_select_container.hidden {
        display: none !important;
        top: -100% !important;
      }
      .player_container .infra,
      .player_container .infra iframe {
        width: 100% !important;
        height: 100% !important;
        border: 0 !important;
      }
      .changeOptions {
        background: #14ce008c !important;
        color: #fff !important;
        padding: 8px 16px !important;
        border-radius: 0 0 10px 10px !important;
        font-weight: 700 !important;
        font-size: 13px !important;
        position: absolute !important;
        top: 0 !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        z-index: 9999 !important;
        cursor: pointer !important;
        transition: opacity .2s ease !important;
      }
      .changeOptions:hover {
        opacity: .8 !important;
      }
    </style>
    `;

    const autoPlayScript = `
    <script>
      $(document).ready(function() {
        setTimeout(function() {
          var firstItem = $('.player_select_item').first();
          if (firstItem.length && !$('.player_container').hasClass('visible')) {
            firstItem.trigger('click');
          }
        }, 120);
      });
    </script>
    `;

    if (html.includes('</head>')) {
      html = html.replace('</head>', `${playerStyles}</head>`);
    } else {
      html = playerStyles + html;
    }

    if (html.includes('</body>')) {
      html = html.replace('</body>', `${autoPlayScript}</body>`);
    } else {
      html = html + autoPlayScript;
    }

    return res.status(200).send(html);
  } catch (err) {
    return res.status(500).send(`Proxy Error: ${err.message}`);
  }
}
