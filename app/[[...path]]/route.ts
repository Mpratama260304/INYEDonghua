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
  let output = replaceOrigin(html, publicUrl.origin);

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

function forwardedHeaders(request: Request) {
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("connection");
  headers.delete("cf-connecting-ip");
  headers.set("accept-encoding", "identity");
  headers.set("x-forwarded-host", new URL(request.url).host);
  headers.set("x-forwarded-proto", new URL(request.url).protocol.slice(0, -1));
  return headers;
}

function responseHeaders(upstream: Response, publicOrigin: string, transformed: boolean) {
  const headers = new Headers(upstream.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  if (transformed) headers.delete("etag");

  const location = headers.get("location");
  if (location) headers.set("location", replaceOrigin(location, publicOrigin));
  for (const name of ["link", "content-security-policy", "refresh"]) {
    const value = headers.get(name);
    if (value) headers.set(name, replaceOrigin(value, publicOrigin));
  }
  if (headers.get("access-control-allow-origin") === ORIGIN.origin) {
    headers.set("access-control-allow-origin", publicOrigin);
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

async function sitemap(request: Request, publicUrl: URL) {
  for (const path of SITEMAP_CANDIDATES) {
    try {
      const response = await fetch(new URL(path, ORIGIN), {
        headers: {
          accept: "application/xml,text/xml;q=0.9,*/*;q=0.5",
          "user-agent": request.headers.get("user-agent") || "SEO-Mirror-Sites/1.0",
        },
      });
      if (!response.ok) continue;
      const source = await response.text();
      if (!/<(?:urlset|sitemapindex)(?:\s|>)/i.test(source)) continue;
      return new Response(replaceOrigin(source, publicUrl.origin), {
        status: 200,
        headers: {
          "content-type": "application/xml; charset=utf-8",
          "cache-control": "public, max-age=900",
          "x-sitemap-source": path,
        },
      });
    } catch {
      // Coba kandidat berikutnya.
    }
  }

  const homepage = htmlEscape(`${publicUrl.origin}/`);
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${homepage}</loc></url></urlset>`,
    {
      status: 200,
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "public, max-age=300",
        "x-sitemap-source": "fallback-homepage-only",
      },
    },
  );
}

async function proxy(request: Request) {
  const publicUrl = new URL(request.url);

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
  if (publicUrl.pathname === "/sitemap.xml") return sitemap(request, publicUrl);

  const init: RequestInit = {
    method: request.method,
    headers: forwardedHeaders(request),
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
    const headers = responseHeaders(upstream, publicUrl.origin, transformed);

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
      body = replaceOrigin(body, publicUrl.origin);
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
