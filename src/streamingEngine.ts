/**
 * ============================================================================
 * MÓDULO DE TRANSMISSÃO SUPERCDN / POBRE PLAY (plenoflu.com)
 * ============================================================================
 * 
 * Este módulo implementa a integração oficial com a infraestrutura de streaming
 * embed do SuperCDN (Pobre Play) via 'plenoflu.com', utilizando identificadores
 * globais do IMDb (ex: 'tt10872600') para execução de filmes e séries em iframe.
 * 
 * Regras de URL da Documentação:
 * - Filmes:            https://plenoflu.com/movie/{imdb_id}
 * - Séries (Geral):    https://plenoflu.com/tvshow/{imdb_id}
 * - Temporadas:        https://plenoflu.com/tvshow/{imdb_id}/{season}
 * - Episódios:         https://plenoflu.com/tvshow/{imdb_id}/{season}/{episode}
 */

// Chave pública da API do TMDB utilizada para conversão de título para IMDb ID
export const TMDB_API_KEY = "4b50180f870c7d5977cee36f9da052ec";

export type ContentType = 'movie' | 'tv' | 'tvshow';

export interface SuperCDNPlaybackResult {
  imdbId: string;
  tipo: 'movie' | 'tvshow';
  season?: string | number;
  episode?: string | number;
  embedUrl: string;
  iframeHtml: string;
  contentInfo?: {
    title: string;
    year?: string | number;
    overview?: string;
    poster?: string;
    tmdbId?: number;
  };
}

/**
 * 1. OBTENÇÃO DO IMDB ID (Conversão de Nome/Ano -> 'tt...')
 * 
 * Consulta a API pública de metadados do The Movie Database (TMDB) para localizar
 * a obra pelo título e extrair o código canônico do IMDb correspondente.
 * Se o parâmetro 'nomeConteudo' já for um IMDb ID válido, ele é retornado diretamente.
 * 
 * @param nomeConteudo Nome do filme ou série (ex: "Vingadores: Ultimato", "Breaking Bad", "Batman") ou código IMDb já existente ("tt10872600")
 * @param ano Ano de lançamento para desempate preciso (opcional)
 * @param tipo Tipo de conteúdo: 'movie' para filmes ou 'tv'/'tvshow' para séries (padrão: 'movie')
 * @returns Código IMDb no formato 'tt1234567'
 */
export async function obterImdbId(
  nomeConteudo: string,
  ano?: string | number,
  tipo: ContentType = 'movie'
): Promise<string> {
  if (!nomeConteudo || !nomeConteudo.trim()) {
    throw new Error("[SuperCDN] Nome do conteúdo não fornecido para busca do IMDb ID.");
  }

  const termoLimpo = nomeConteudo.trim();

  // Caso o usuário já tenha passado diretamente o IMDb ID (ex: "tt0816692"):
  const regexImdbDireto = /^tt\d{6,10}$/i;
  if (regexImdbDireto.test(termoLimpo)) {
    console.log(`[SuperCDN] IMDb ID direto fornecido: ${termoLimpo}`);
    return termoLimpo.toLowerCase();
  }

  const isTvShow = tipo === 'tv' || tipo === 'tvshow';
  const anoStr = ano ? String(ano).trim() : '';

  try {
    // -------------------------------------------------------------------------
    // PASSO 1: Pesquisa no TMDB (Filmes ou Séries)
    // -------------------------------------------------------------------------
    let endpointBusca = '';
    if (isTvShow) {
      endpointBusca = `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(termoLimpo)}&language=pt-BR&include_adult=false${anoStr ? `&first_air_date_year=${anoStr}` : ''}`;
    } else {
      endpointBusca = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(termoLimpo)}&language=pt-BR&include_adult=false${anoStr ? `&year=${anoStr}` : ''}`;
    }

    let resBusca = await fetch(endpointBusca);
    let dadosBusca = await resBusca.json();
    let resultados = dadosBusca.results || [];

    // Se a busca com o ano estrito não retornar nada, tenta sem o ano para flexibilidade
    if (resultados.length === 0 && anoStr) {
      console.log(`[SuperCDN] Nenhum resultado com ano ${anoStr}. Tentando busca ampla sem restrição de ano para "${termoLimpo}"...`);
      const fallbackUrl = isTvShow
        ? `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(termoLimpo)}&language=pt-BR&include_adult=false`
        : `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(termoLimpo)}&language=pt-BR&include_adult=false`;
      
      const resFallback = await fetch(fallbackUrl);
      const dadosFallback = await resFallback.json();
      resultados = dadosFallback.results || [];
    }

    // Se ainda não encontrou e for busca multi
    if (resultados.length === 0) {
      const multiUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(termoLimpo)}&language=pt-BR&include_adult=false`;
      const resMulti = await fetch(multiUrl);
      const dadosMulti = await resMulti.json();
      resultados = (dadosMulti.results || []).filter((r: any) => r.media_type === 'movie' || r.media_type === 'tv');
    }

    if (resultados.length === 0) {
      throw new Error(`Nenhum título encontrado no catálogo para: "${termoLimpo}"`);
    }

    const midiaEncontrada = resultados[0];
    const tmdbId = midiaEncontrada.id;
    const mediaTypeReal = midiaEncontrada.media_type || (isTvShow ? 'tv' : 'movie');

    console.log(`[SuperCDN] Mídia identificada no TMDB: "${midiaEncontrada.title || midiaEncontrada.name}" (TMDB ID: ${tmdbId}, Tipo: ${mediaTypeReal})`);

    // -------------------------------------------------------------------------
    // PASSO 2: Obtenção do código IMDb via external_ids do TMDB
    // -------------------------------------------------------------------------
    let imdbIdEncontrado: string | null = null;

    if (mediaTypeReal === 'tv') {
      const extRes = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`);
      if (extRes.ok) {
        const extJson = await extRes.json();
        imdbIdEncontrado = extJson.imdb_id || null;
      }
    } else {
      // Para filmes, o endpoint principal movie/{id} já contém imdb_id
      const movieRes = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`);
      if (movieRes.ok) {
        const movieJson = await movieRes.json();
        imdbIdEncontrado = movieJson.imdb_id || null;
      }

      // Se não vier no objeto principal, consulta external_ids
      if (!imdbIdEncontrado) {
        const extRes = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`);
        if (extRes.ok) {
          const extJson = await extRes.json();
          imdbIdEncontrado = extJson.imdb_id || null;
        }
      }
    }

    // -------------------------------------------------------------------------
    // PASSO 3: Validação do formato do IMDb ID ('tt...')
    // -------------------------------------------------------------------------
    if (imdbIdEncontrado && regexImdbDireto.test(imdbIdEncontrado.trim())) {
      const cleanImdb = imdbIdEncontrado.trim().toLowerCase();
      console.log(`[SuperCDN] IMDb ID extraído com sucesso: ${cleanImdb}`);
      return cleanImdb;
    }

    // Fallback secundário: Consulta à OMDb API pública se disponível
    try {
      const omdbRes = await fetch(`https://www.omdbapi.com/?t=${encodeURIComponent(termoLimpo)}&y=${anoStr}&apikey=b7da8d63`);
      if (omdbRes.ok) {
        const omdbJson = await omdbRes.json();
        if (omdbJson && omdbJson.imdbID && regexImdbDireto.test(omdbJson.imdbID)) {
          console.log(`[SuperCDN] IMDb ID recuperado via OMDb fallback: ${omdbJson.imdbID}`);
          return omdbJson.imdbID.toLowerCase();
        }
      }
    } catch (omdbErr) {}

    throw new Error(`O título "${termoLimpo}" foi localizado no catálogo, mas não possui código IMDb associado.`);

  } catch (erro: any) {
    console.error("[SuperCDN] Falha ao converter termo para IMDb ID:", erro);
    throw new Error(erro.message || "Não foi possível obter o código IMDb para o conteúdo solicitado.");
  }
}

/**
 * 2. CONSTRUTOR DE URLS SUPERCDN (Padrão Oficial plenoflu.com)
 * 
 * Monta estritamente a URL canônica de transmissão de acordo com a documentação:
 * - Filmes:            https://plenoflu.com/movie/{imdb_id}
 * - Séries (Geral):    https://plenoflu.com/tvshow/{imdb_id}
 * - Temporadas:        https://plenoflu.com/tvshow/{imdb_id}/{season}
 * - Episódios:         https://plenoflu.com/tvshow/{imdb_id}/{season}/{episode}
 * 
 * @param imdbId Código do IMDb (ex: 'tt10872600')
 * @param tipo 'movie' para filme ou 'tvshow' para séries
/**
 * 2. IMPLEMENTAÇÃO OFICIAL DO SUPERCDN (PLENOFLU.COM v1.0)
 * Conforme documentação em plenoflu.com/doc/
 * 
 * Endpoints Oficiais:
 * - Filmes:     https://plenoflu.com/movie/{imdb}
 * - Séries:     https://plenoflu.com/tvshow/{imdb}
 * - Temporadas: https://plenoflu.com/tvshow/{imdb}/{season}
 * - Episódios:  https://plenoflu.com/tvshow/{imdb}/{season}/{episode}
 */
export function SuperCDNJSPlugin(
  type: 'movie' | 'tvshow' | 'tv' = 'movie',
  imdb: string = '',
  season: string | number = '',
  episode: string | number = ''
): string {
  const cleanType = (type === 'tv' || type === 'tvshow') ? 'tvshow' : 'movie';
  let s = (season !== undefined && season !== null && season !== '') ? String(season).trim() : '';
  let e = (episode !== undefined && episode !== null && episode !== '') ? String(episode).trim() : '';

  if (cleanType === 'movie') {
    s = '';
    e = '';
  } else {
    if (s !== '') { s = '/' + s; }
    if (e !== '') { e = '/' + e; }
  }

  const streamUrl = '/api-plenoflu/' + cleanType + '/' + imdb + s + e;

  if (typeof document !== 'undefined') {
    const frame = document.getElementById('SuperCDNContainerVideo') || document.getElementById('iframe-mount-point');
    if (frame) {
      frame.innerHTML = '<iframe src="' + streamUrl + '" width="100%" height="100%" scrolling="no" frameborder="0" allowfullscreen="" webkitallowfullscreen="" mozallowfullscreen="" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="no-referrer" class="w-full h-full border-0"></iframe>';
    }
  }

  return streamUrl;
}

export function montarUrlSuperCDN(
  imdbId: string,
  tipo: 'movie' | 'tvshow' | 'tv' = 'movie',
  season: string | number = '',
  episode: string | number = ''
): string {
  const cleanType = (tipo === 'tv' || tipo === 'tvshow') ? 'tvshow' : 'movie';
  let s = (season !== undefined && season !== null && season !== '') ? String(season).trim() : '';
  let e = (episode !== undefined && episode !== null && episode !== '') ? String(episode).trim() : '';

  if (cleanType === 'movie') {
    s = '';
    e = '';
  } else {
    if (s !== '') { s = '/' + s; }
    if (e !== '') { e = '/' + e; }
  }

  return 'https://plenoflu.com/' + cleanType + '/' + imdbId + s + e;
}

/**
 * 3. ESTRUTURA DO COMPONENTE HTML
 * Constrói e retorna a tag iFrame com atributos da documentação oficial SuperCDN:
 * width="100%" height="100%" scrolling="no" frameborder="0" allowfullscreen="" webkitallowfullscreen="" mozallowfullscreen=""
 */
export function renderizarPlayerSuperCDN(
  imdbId: string,
  tipo: 'movie' | 'tvshow' | 'tv' = 'movie',
  season: string | number = '',
  episode: string | number = ''
): string {
  const cleanType = (tipo === 'tv' || tipo === 'tvshow') ? 'tvshow' : 'movie';
  let s = (season !== undefined && season !== null && season !== '') ? String(season).trim() : '';
  let e = (episode !== undefined && episode !== null && episode !== '') ? String(episode).trim() : '';

  if (cleanType === 'movie') {
    s = '';
    e = '';
  } else {
    if (s !== '') { s = '/' + s; }
    if (e !== '') { e = '/' + e; }
  }

  const streamUrl = '/api-plenoflu/' + cleanType + '/' + imdbId + s + e;

  return '<iframe src="' + streamUrl + '" width="100%" height="100%" scrolling="no" frameborder="0" allowfullscreen="" webkitallowfullscreen="" mozallowfullscreen="" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="no-referrer" class="w-full h-full border-0"></iframe>';
}

/**
 * ARQUITETURA INDIVIDUAL DOS CANAIS DE REPRODUÇÃO:
 * - Canal 1: Reprodução Direta (Plenoflu SuperCDN oficial)
 * - Canal 2: Verificação CAPTCHA + Seleção de Servidor (Principal/Alternativo) e Idioma (Dublado/Legendado)
 * - Canal 3: Verificação CAPTCHA + Reprodução Direta (sem menus de servidores ou idiomas de Canal 2)
 */
export function obterUrlCanalPlayer(
  canalNumero: number, // 1, 2 ou 3
  imdbId: string,
  tipo: 'movie' | 'tvshow' | 'tv' = 'movie',
  season: string | number = 1,
  episode: string | number = 1
): string {
  const isTv = tipo === 'tvshow' || tipo === 'tv';
  const s = season || 1;
  const ep = episode || 1;

  if (canalNumero === 1) {
    // CANAL 1 — Reprodução direta (Plenoflu oficial)
    const sPath = isTv ? `/${s}/${ep}` : '';
    const cleanType = isTv ? 'tvshow' : 'movie';
    return `/api-plenoflu/${cleanType}/${imdbId}${sPath}`;
  }

  if (canalNumero === 2) {
    // CANAL 2 — Verificação CAPTCHA e seleção de reprodução (Servidor Principal/Alternativo + Dublado/Legendado)
    return isTv
      ? `https://superflixapi.fun/serie/${imdbId}/${s}/${ep}`
      : `https://superflixapi.fun/filme/${imdbId}`;
  }

  if (canalNumero === 3) {
    // CANAL 3 — StreamBetter (reprodução alternativa direta)
    return isTv
      ? `https://streambetter.lol/serie/${imdbId}/${s}/${ep}`
      : `https://streambetter.lol/filme/${imdbId}`;
  }

  return montarUrlSuperCDN(imdbId, tipo, season, episode);
}

/**
 * 4. FLUXO COMPLETO E PRONTO: BUSCA + GERAÇÃO DO PLAYER SUPERCDN
 * 
 * Recebe o nome digitado pelo usuário, resolve o IMDb ID via TMDB/OMDb,
 * monta a URL oficial e retorna o HTML do iframe pronto para injeção no DOM.
 * 
 * @param nomeConteudo Título pesquisado pelo usuário (ex: "Vingadores", "Breaking Bad")
 * @param ano Ano de lançamento para precisão (opcional)
 * @param tipo 'movie' ou 'tvshow' (padrão: 'movie')
 * @param season Número da temporada (se for série)
 * @param episode Número do episódio (se for série)
 */
export async function buscarEReproduzirSuperCDN(
  nomeConteudo: string,
  ano?: string | number,
  tipo: 'movie' | 'tvshow' = 'movie',
  season: string | number = '',
  episode: string | number = ''
): Promise<SuperCDNPlaybackResult> {
  const imdbId = await obterImdbId(nomeConteudo, ano, tipo);
  const embedUrl = montarUrlSuperCDN(imdbId, tipo, season, episode);
  const iframeHtml = renderizarPlayerSuperCDN(imdbId, tipo, season, episode);

  return {
    imdbId,
    tipo,
    season,
    episode,
    embedUrl,
    iframeHtml,
    contentInfo: {
      title: nomeConteudo,
      year: ano
    }
  };
}

export function renderizarPlayerNativo(videoUrl: string, poster: string = ''): string {
  return `<video 
    src="${videoUrl}" 
    poster="${poster}" 
    controls 
    autoplay 
    playsinline 
    class="w-full h-full object-contain bg-black rounded-lg">
    Seu navegador não suporta reprodução de vídeo nativa.
  </video>`;
}

// Exportações padrão para ambientes Node.js ou navegador
export default {
  TMDB_API_KEY,
  obterImdbId,
  SuperCDNJSPlugin,
  montarUrlSuperCDN,
  renderizarPlayerSuperCDN,
  renderizarPlayerNativo,
  obterUrlCanalPlayer,
  buscarEReproduzirSuperCDN
};
