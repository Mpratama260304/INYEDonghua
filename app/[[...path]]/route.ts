const ORIGIN = new URL("https://donghua.ipkzone.my.id");
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "fbclid",
  "msclkid",
]);
const SITEMAP_CANDIDATES = [
  "/sitemap.xml",
  "/sitemap_index.xml",
  "/wp-sitemap.xml",
];
// Halaman statis inti yang selalu masuk sitemap.
const STATIC_PATHS = ["/", "/ongoing", "/completed", "/schedule"];
// Bagian listing yang memiliki pagination `/<section>/page/N`.
const LISTING_SECTIONS = ["ongoing", "completed"] as const;

export const dynamic = "force-dynamic";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function replaceOrigin(value: string, publicOrigin: string) {
  const sources = [
    ORIGIN.origin,
    `https://${ORIGIN.host}`,
    `http://${ORIGIN.host}`,
    `//${ORIGIN.host}`,
  ];

  let output = value;
  for (const source of sources) {
    const target = source.startsWith("//")
      ? `//${new URL(publicOrigin).host}`
      : publicOrigin;
    output = output.split(source).join(target);
    output = output
      .split(source.replaceAll("/", "\\/"))
      .join(target.replaceAll("/", "\\/"));
    output = output
      .split(encodeURIComponent(source))
      .join(encodeURIComponent(target));
  }
  return output;
}

function enforcePublicHttps(value: string, publicUrl: URL) {
  if (publicUrl.protocol !== "https:") return value;

  const source = `http://${publicUrl.host}`;
  const target = publicUrl.origin;
  return value
    .split(source).join(target)
    .split(source.replaceAll("/", "\\/")).join(target.replaceAll("/", "\\/"))
    .split(encodeURIComponent(source)).join(encodeURIComponent(target));
}

function rewritePublicReferences(value: string, publicUrl: URL) {
  return enforcePublicHttps(replaceOrigin(value, publicUrl.origin), publicUrl);
}

function rewriteJson(value: JsonValue, publicOrigin: string): JsonValue {
  if (typeof value === "string") return replaceOrigin(value, publicOrigin);
  if (Array.isArray(value)) return value.map((item) => rewriteJson(item, publicOrigin));
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      value[key] = rewriteJson(child, publicOrigin);
    }
  }
  return value;
}

function labelFromSlug(value: string) {
  try {
    return decodeURIComponent(value)
      .replace(/[-_]+/g, " ")
      .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  } catch {
    return value.replace(/[-_]+/g, " ");
  }
}

function repairBreadcrumbs(value: JsonValue) {
  let found = false;

  function visit(node: JsonValue) {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;

    if (node["@type"] === "BreadcrumbList" && Array.isArray(node.itemListElement)) {
      node.itemListElement = node.itemListElement
        .filter((item) => item && (typeof item === "object" || typeof item === "string"))
        .map((item, index) => {
          const entry: { [key: string]: JsonValue } =
            typeof item === "string" ? { item } : item as { [key: string]: JsonValue };
          entry["@type"] = "ListItem";
          entry.position = index + 1;
          if (!entry.name) {
            const rawItem = typeof entry.item === "string" ? entry.item : "";
            const segment = rawItem.split("/").filter(Boolean).at(-1) || `halaman-${index + 1}`;
            entry.name = index === 0 ? "Beranda" : labelFromSlug(segment);
          }
          return entry;
        });
      found = node.itemListElement.length > 0 || found;
    }

    Object.values(node).forEach(visit);
  }

  visit(value);
  return found;
}

function breadcrumbFor(url: URL, title: string) {
  const segments = url.pathname.split("/").filter(Boolean);
  if (!segments.length) return null;

  const items: Array<Record<string, string | number>> = [
    {
      "@type": "ListItem",
      position: 1,
      name: "Beranda",
      item: `${url.origin}/`,
    },
  ];
  let currentPath = "";
  segments.forEach((segment, index) => {
    currentPath += `/${segment}`;
    const isLast = index === segments.length - 1;
    items.push({
      "@type": "ListItem",
      position: index + 2,
      name: isLast && title ? title : labelFromSlug(segment),
      ...(isLast ? {} : { item: `${url.origin}${currentPath}/` }),
    });
  });

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items,
  };
}

function htmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function transformHtml(html: string, publicUrl: URL, status: number) {
  let output = rewritePublicReferences(html, publicUrl);

  output = output.replace(
    /<link\b(?=[^>]*\brel\s*=\s*["'][^"']*\bcanonical\b[^"']*["'])[^>]*>\s*/gi,
    "",
  );
  output = output.replace(
    /<meta\b(?=[^>]*(?:property|name)\s*=\s*["'](?:og:url|twitter:url)["'])[^>]*>\s*/gi,
    "",
  );

  let breadcrumbFound = false;
  output = output.replace(
    /<script\b(?=[^>]*type\s*=\s*["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi,
    (_full, json: string) => {
      try {
        const parsed = rewriteJson(JSON.parse(json.trim()) as JsonValue, publicUrl.origin);
        breadcrumbFound = repairBreadcrumbs(parsed) || breadcrumbFound;
        return `<script type="application/ld+json">${JSON.stringify(parsed)}</script>`;
      } catch {
        return "";
      }
    },
  );

  const titleMatch = output.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
    || output.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = (titleMatch?.[1] || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const generatedBreadcrumb = breadcrumbFound ? null : breadcrumbFor(publicUrl, title);

  const canonical = htmlEscape(publicUrl.toString());
  const seoHead = [
    `<link rel="canonical" href="${canonical}">`,
    `<meta property="og:url" content="${canonical}">`,
    '<meta name="codex-preview" content="development">',
    generatedBreadcrumb
      ? `<script type="application/ld+json">${JSON.stringify(generatedBreadcrumb)}</script>`
      : "",
    status === 404 || status === 410
      ? '<meta name="robots" content="noindex, follow">'
      : "",
  ].join("");

  if (/<\/head>/i.test(output)) {
    output = output.replace(/<\/head>/i, `${seoHead}</head>`);
  } else if (/<html\b[^>]*>/i.test(output)) {
    output = output.replace(/<html\b([^>]*)>/i, `<html$1><head>${seoHead}</head>`);
  } else {
    output = `<!doctype html><html><head>${seoHead}</head><body>${output}</body></html>`;
  }

  if (status === 404 || status === 410) {
    output = output.replace(
      /<meta\b(?=[^>]*name\s*=\s*["'](?:robots|googlebot)["'])(?![^>]*noindex)[^>]*>\s*/gi,
      "",
    );
  }
  return output;
}

function cleanPublicUrl(url: URL) {
  const cleaned = new URL(url);
  for (const key of [...cleaned.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) cleaned.searchParams.delete(key);
  }
  cleaned.searchParams.sort();
  return cleaned;
}

function upstreamUrl(publicUrl: URL) {
  return new URL(`${publicUrl.pathname}${publicUrl.search}`, ORIGIN);
}

function publicRequestUrl(request: Request) {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")
    ?.split(",")[0]
    .trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")
    ?.split(",")[0]
    .trim()
    .toLowerCase();

  if (forwardedHost) url.host = forwardedHost;
  if (forwardedProto === "http" || forwardedProto === "https") {
    url.protocol = `${forwardedProto}:`;
  }
  return url;
}

function forwardedHeaders(request: Request, publicUrl: URL) {
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("connection");
  headers.delete("cf-connecting-ip");
  headers.set("accept-encoding", "identity");
  headers.set("x-forwarded-host", publicUrl.host);
  headers.set("x-forwarded-proto", publicUrl.protocol.slice(0, -1));
  return headers;
}

function responseHeaders(upstream: Response, publicUrl: URL, transformed: boolean) {
  const headers = new Headers(upstream.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  if (transformed) headers.delete("etag");

  const location = headers.get("location");
  if (location) headers.set("location", rewritePublicReferences(location, publicUrl));
  for (const name of ["link", "content-security-policy", "refresh"]) {
    const value = headers.get(name);
    if (value) headers.set(name, rewritePublicReferences(value, publicUrl));
  }
  if (headers.get("access-control-allow-origin") === ORIGIN.origin) {
    headers.set("access-control-allow-origin", publicUrl.origin);
  }
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  return headers;
}

function robots(publicUrl: URL) {
  return new Response(
    [
      "User-agent: *",
      "Allow: /",
      "Disallow: /_mirror/",
      `Sitemap: ${publicUrl.origin}/sitemap.xml`,
      "",
    ].join("\n"),
    {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    },
  );
}

async function fetchOriginText(request: Request, path: string) {
  try {
    const response = await fetch(new URL(path, ORIGIN), {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5",
        "user-agent": request.headers.get("user-agent") || "SEO-Mirror-Sites/1.0",
        "accept-encoding": "identity",
      },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function extractPaths(html: string, prefix: string) {
  const found = new Set<string>();
  const pattern = /href\s*=\s*["'](\/[^"'#?\s]*)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const path = match[1];
    if (path.startsWith(prefix)) found.add(path);
  }
  return [...found];
}

function lastPageNumber(html: string, base: string) {
  const pattern = new RegExp(`/${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/page/(\\d+)`, "gi");
  let max = 1;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    max = Math.max(max, Number(match[1]));
  }
  return max;
}

function absoluteLoc(path: string, publicUrl: URL) {
  return htmlEscape(new URL(path, publicUrl.origin).toString());
}

function urlsetXml(paths: Iterable<string>, publicUrl: URL) {
  const lastmod = new Date().toISOString();
  const entries = [...new Set(paths)]
    .map((path) => `<url><loc>${absoluteLoc(path, publicUrl)}</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq></url>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`;
}

function sitemapIndexXml(paths: Iterable<string>, publicUrl: URL) {
  const lastmod = new Date().toISOString();
  const entries = [...new Set(paths)]
    .map((path) => `<sitemap><loc>${absoluteLoc(path, publicUrl)}</loc><lastmod>${lastmod}</lastmod></sitemap>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</sitemapindex>`;
}

function xmlResponse(body: string, source: string, maxAge: number) {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}`,
      "x-sitemap-source": source,
    },
  });
}

async function upstreamSitemap(request: Request, publicUrl: URL) {
  for (const path of SITEMAP_CANDIDATES) {
    const source = await fetchOriginText(request, path);
    if (!source) continue;
    if (!/<(?:urlset|sitemapindex)(?:\s|>)/i.test(source)) continue;
    return xmlResponse(rewritePublicReferences(source, publicUrl), `upstream:${path}`, 900);
  }
  return null;
}

async function sitemapIndex(request: Request, publicUrl: URL) {
  const passthrough = await upstreamSitemap(request, publicUrl);
  if (passthrough) return passthrough;

  const children = ["/sitemap-pages.xml", "/sitemap-series.xml"];
  for (const section of LISTING_SECTIONS) {
    const html = await fetchOriginText(request, `/${section}`);
    const pages = html ? lastPageNumber(html, section) : 1;
    for (let page = 1; page <= pages; page++) {
      // Query diurutkan (page lalu section) agar cocok dengan normalisasi URL dan menghindari redirect.
      children.push(`/sitemap-episodes.xml?page=${page}&section=${section}`);
    }
  }
  return xmlResponse(sitemapIndexXml(children, publicUrl), "generated-index", 900);
}

async function sitemapPages(request: Request, publicUrl: URL) {
  const paths = new Set<string>(STATIC_PATHS);

  const home = await fetchOriginText(request, "/");
  const genres = home
    ? extractPaths(home, "/genres/").filter((path) => /^\/genres\/[^/]+$/.test(path))
    : [];
  for (const genre of genres) paths.add(genre);

  for (const genre of genres) {
    const html = await fetchOriginText(request, genre);
    if (!html) continue;
    const pages = lastPageNumber(html, genre.slice(1));
    for (let page = 2; page <= pages; page++) paths.add(`${genre}/page/${page}`);
  }

  return xmlResponse(urlsetXml(paths, publicUrl), "generated-pages", 3600);
}

async function sitemapSeries(request: Request, publicUrl: URL) {
  const series = new Set<string>();

  for (const section of LISTING_SECTIONS) {
    const first = await fetchOriginText(request, `/${section}`);
    if (!first) continue;
    for (const path of extractPaths(first, "/seri/")) series.add(path);

    const pages = lastPageNumber(first, section);
    for (let page = 2; page <= pages; page++) {
      const html = await fetchOriginText(request, `/${section}/page/${page}`);
      if (!html) continue;
      for (const path of extractPaths(html, "/seri/")) series.add(path);
    }
  }

  return xmlResponse(urlsetXml(series, publicUrl), "generated-series", 1800);
}

async function sitemapEpisodes(request: Request, publicUrl: URL) {
  const section = publicUrl.searchParams.get("section") ?? "";
  const page = Number(publicUrl.searchParams.get("page") ?? "1");

  const validSection = (LISTING_SECTIONS as readonly string[]).includes(section);
  if (!validSection || !Number.isInteger(page) || page < 1) {
    return xmlResponse(urlsetXml([], publicUrl), "generated-episodes-invalid", 300);
  }

  const listPath = page <= 1 ? `/${section}` : `/${section}/page/${page}`;
  const listing = await fetchOriginText(request, listPath);
  const episodes = new Set<string>();

  if (listing) {
    for (const watch of extractPaths(listing, "/watch/")) episodes.add(watch);
    for (const seri of extractPaths(listing, "/seri/")) {
      const html = await fetchOriginText(request, seri);
      if (!html) continue;
      for (const watch of extractPaths(html, "/watch/")) episodes.add(watch);
    }
  }

  return xmlResponse(urlsetXml(episodes, publicUrl), `generated-episodes-${section}-${page}`, 1800);
}

async function proxy(request: Request) {
  const publicUrl = publicRequestUrl(request);

  if (publicUrl.pathname === "/healthz" || publicUrl.pathname === "/_mirror/health") {
    return Response.json({ ok: true, origin: ORIGIN.host }, {
      headers: { "cache-control": "no-store" },
    });
  }

  const cleanedUrl = cleanPublicUrl(publicUrl);
  if ((request.method === "GET" || request.method === "HEAD") && cleanedUrl.toString() !== publicUrl.toString()) {
    return new Response(null, {
      status: 308,
      headers: {
        location: cleanedUrl.toString(),
        "cache-control": "public, max-age=86400",
      },
    });
  }

  if (publicUrl.pathname === "/robots.txt") return robots(publicUrl);
  if (publicUrl.pathname === "/sitemap.xml") return sitemapIndex(request, publicUrl);
  if (publicUrl.pathname === "/sitemap-pages.xml") return sitemapPages(request, publicUrl);
  if (publicUrl.pathname === "/sitemap-series.xml") return sitemapSeries(request, publicUrl);
  if (publicUrl.pathname === "/sitemap-episodes.xml") return sitemapEpisodes(request, publicUrl);

  const init: RequestInit = {
    method: request.method,
    headers: forwardedHeaders(request, publicUrl),
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;

  try {
    const upstream = await fetch(upstreamUrl(publicUrl), init);
    const contentType = upstream.headers.get("content-type") || "";
    const isHtml = /text\/html|application\/xhtml\+xml/i.test(contentType);
    const isXml = /(?:application|text)\/(?:[\w.+-]*\+)?xml/i.test(contentType)
      || /\.xml$/i.test(publicUrl.pathname);
    const isCss = /text\/css/i.test(contentType);
    const transformed = isHtml || isXml || isCss;
    const headers = responseHeaders(upstream, publicUrl, transformed);

    if (upstream.status === 404 || upstream.status === 410) {
      headers.set("x-robots-tag", "noindex, follow");
    }

    if (request.method === "HEAD" || !upstream.body) {
      return new Response(null, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    }

    if (!transformed) {
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    }

    let body = await upstream.text();
    if (isHtml) {
      body = transformHtml(body, publicUrl, upstream.status);
      headers.set("content-type", "text/html; charset=utf-8");
    } else {
      body = rewritePublicReferences(body, publicUrl);
    }
    return new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (error) {
    return new Response(`Upstream tidak dapat diakses: ${error instanceof Error ? error.message : "unknown error"}`, {
      status: 502,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex",
      },
    });
  }
}

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
