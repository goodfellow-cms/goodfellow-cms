/**
 * A made-up WordPress site for tests: St. Brendan's, a parish, as an export
 * file (`sampleWordPressExport()`) and as WordPress's API answers it
 * (`fakeWordPress()`), with pages, posts, categories, tags, menus, media,
 * a draft, a private post, comments and a kind of content that isn't imported.
 */

export const SAMPLE_WORDPRESS_URL = "https://stbrendan.example.org";

const site = SAMPLE_WORDPRESS_URL;
const uploads = `${site}/wp-content/uploads/2026`;

interface SampleItem {
  id: number;
  type: string;
  status: string;
  title: string;
  slug: string;
  link: string;
  date: string;
  parent?: number;
  order?: number;
  content: string;
  /** What WordPress's API shows. */
  rendered: string;
  excerpt?: string;
  categories?: string[];
  tags?: string[];
  image?: number;
  comments?: number;
}

const REUSABLE = `<!-- wp:paragraph -->
<p>Everyone is welcome.</p>
<!-- /wp:paragraph -->`;

const ITEMS: SampleItem[] = [
  {
    id: 2,
    type: "page",
    status: "publish",
    title: "Welcome to St. Brendan's",
    slug: "home",
    link: `${site}/`,
    date: "2026-01-05 09:00:00",
    order: 0,
    content: `<!-- wp:heading {"level":2} -->
<h2 class="wp-block-heading">Mass times</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Sunday Mass is at <strong>9:00</strong> and <em>11:00</em>. <a href="${site}/about/">Find out more about us</a>.</p>
<!-- /wp:paragraph -->

<!-- wp:image {"id":10,"sizeSlug":"large"} -->
<figure class="wp-block-image size-large"><img src="${uploads}/05/church-1024x768.jpg" alt="" class="wp-image-10"/><figcaption class="wp-element-caption">Our church in spring</figcaption></figure>
<!-- /wp:image -->

<!-- wp:columns -->
<div class="wp-block-columns"><!-- wp:column -->
<div class="wp-block-column"><!-- wp:heading {"level":3} -->
<h3 class="wp-block-heading">Visit</h3>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>1 Church Lane, Springfield</p>
<!-- /wp:paragraph --></div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column"><!-- wp:paragraph -->
<p>Call 555-0123.</p>
<!-- /wp:paragraph --></div>
<!-- /wp:column --></div>
<!-- /wp:columns -->

<!-- wp:buttons -->
<div class="wp-block-buttons"><!-- wp:button -->
<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="${site}/about/staff/">Meet the staff</a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons -->

<!-- wp:block {"ref":30} /-->

<!-- wp:latest-posts {"postsToShow":3} /-->`,
    rendered: `<h2 class="wp-block-heading">Mass times</h2>
<p>Sunday Mass is at <strong>9:00</strong> and <em>11:00</em>. <a href="${site}/about/">Find out more about us</a>.</p>
<figure class="wp-block-image size-large"><img src="${uploads}/05/church-1024x768.jpg" alt="" class="wp-image-10"/><figcaption class="wp-element-caption">Our church in spring</figcaption></figure>
<div class="wp-block-columns"><div class="wp-block-column"><h3 class="wp-block-heading">Visit</h3><p>1 Church Lane, Springfield</p></div><div class="wp-block-column"><p>Call 555-0123.</p></div></div>
<div class="wp-block-buttons"><div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="${site}/about/staff/">Meet the staff</a></div></div>
<p>Everyone is welcome.</p>
<ul class="wp-block-latest-posts__list wp-block-latest-posts"><li><a href="${site}/2026/06/parish-picnic/">Parish picnic</a></li></ul>`,
  },
  {
    id: 3,
    type: "page",
    status: "publish",
    title: "About us",
    slug: "about",
    link: `${site}/about/`,
    date: "2026-01-05 09:10:00",
    order: 1,
    content: `We are a parish family in Springfield.

Our <a href="${site}/?page_id=4">staff</a> are here to help.
Call the office any weekday.

[caption id="attachment_13" align="aligncenter" width="800"]<img src="${uploads}/05/choir.jpg" alt="The choir singing" class="wp-image-13" /> The choir at Easter[/caption]

[contact-form-7 id="5" title="Contact"]

Read our <a href="${site}/old-history/">history</a> [sic].`,
    rendered: `<p>We are a parish family in Springfield.</p>
<p>Our <a href="${site}/about/staff/">staff</a> are here to help.<br />
Call the office any weekday.</p>
<figure id="attachment_13" class="wp-caption aligncenter"><img src="${uploads}/05/choir.jpg" alt="The choir singing" class="wp-image-13" /><figcaption class="wp-caption-text">The choir at Easter</figcaption></figure>
<form action="/" method="post"><input name="your-name"></form>
<p>Read our <a href="${site}/old-history/">history</a> [sic].</p>`,
  },
  {
    id: 4,
    type: "page",
    status: "publish",
    title: "Our staff",
    slug: "staff",
    link: `${site}/about/staff/`,
    date: "2026-01-05 09:20:00",
    parent: 3,
    order: 0,
    content: `<!-- wp:table -->
<figure class="wp-block-table"><table><thead><tr><th>Name</th><th>Role</th></tr></thead><tbody><tr><td>Fr. Aidan Walsh</td><td>Pastor</td></tr></tbody></table></figure>
<!-- /wp:table -->

<!-- wp:embed {"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","type":"video","providerNameSlug":"youtube"} -->
<figure class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube"><div class="wp-block-embed__wrapper">
https://www.youtube.com/watch?v=dQw4w9WgXcQ
</div></figure>
<!-- /wp:embed -->

<!-- wp:gallery {"columns":2,"linkTo":"none"} -->
<figure class="wp-block-gallery has-nested-images columns-2 is-cropped"><!-- wp:image {"id":11} -->
<figure class="wp-block-image"><img src="${uploads}/06/picnic.jpg" alt="Families at the picnic" class="wp-image-11"/></figure>
<!-- /wp:image -->

<!-- wp:image {"id":13} -->
<figure class="wp-block-image"><img src="${uploads}/05/choir-300x200.jpg" alt="" class="wp-image-13"/></figure>
<!-- /wp:image --></figure>
<!-- /wp:gallery -->`,
    rendered: `<figure class="wp-block-table"><table><thead><tr><th>Name</th><th>Role</th></tr></thead><tbody><tr><td>Fr. Aidan Walsh</td><td>Pastor</td></tr></tbody></table></figure>
<figure class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube"><div class="wp-block-embed__wrapper"><iframe title="Welcome" src="https://www.youtube.com/embed/dQw4w9WgXcQ?feature=oembed"></iframe></div></figure>
<figure class="wp-block-gallery has-nested-images columns-2 is-cropped"><figure class="wp-block-image"><img src="${uploads}/06/picnic.jpg" alt="Families at the picnic" class="wp-image-11"/></figure><figure class="wp-block-image"><img src="${uploads}/05/choir-300x200.jpg" alt="" class="wp-image-13"/></figure></figure>`,
  },
  {
    id: 5,
    type: "page",
    status: "draft",
    title: "Old history",
    slug: "old-history",
    link: `${site}/?page_id=5`,
    date: "2026-01-06 10:00:00",
    content: "<p>Not ready yet.</p>",
    rendered: "<p>Not ready yet.</p>",
  },
  {
    id: 6,
    type: "page",
    status: "publish",
    title: "News",
    slug: "news",
    link: `${site}/news/`,
    date: "2026-01-05 09:30:00",
    order: 2,
    content: "",
    rendered: "",
  },
  {
    id: 20,
    type: "post",
    status: "publish",
    title: "Parish picnic",
    slug: "parish-picnic",
    link: `${site}/2026/06/parish-picnic/`,
    date: "2026-06-14 12:00:00",
    categories: ["events"],
    tags: ["summer"],
    image: 11,
    comments: 2,
    content: `<!-- wp:paragraph -->
<p>Join us for the <strong>parish picnic</strong> on the green, with <em>games</em> for children.</p>
<!-- /wp:paragraph -->

<!-- wp:list -->
<ul class="wp-block-list"><!-- wp:list-item -->
<li>Bring a dish to share<!-- wp:list -->
<ul class="wp-block-list"><!-- wp:list-item -->
<li>Desserts are welcome</li>
<!-- /wp:list-item --></ul>
<!-- /wp:list --></li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>Games start at 2</li>
<!-- /wp:list-item --></ul>
<!-- /wp:list -->

<!-- wp:quote -->
<blockquote class="wp-block-quote"><!-- wp:paragraph -->
<p>A day for everyone.</p>
<!-- /wp:paragraph --></blockquote>
<!-- /wp:quote -->

<!-- wp:image {"id":11} -->
<figure class="wp-block-image"><img src="${uploads}/06/picnic-768x512.jpg" alt="Families at the picnic" class="wp-image-11"/></figure>
<!-- /wp:image -->

<!-- wp:code -->
<pre class="wp-block-code"><code>Noon to 4</code></pre>
<!-- /wp:code -->

<!-- wp:embed {"url":"https://vimeo.com/76979871","type":"video","providerNameSlug":"vimeo"} -->
<figure class="wp-block-embed is-type-video is-provider-vimeo"><div class="wp-block-embed__wrapper">
https://vimeo.com/76979871
</div></figure>
<!-- /wp:embed -->

<!-- wp:kadence/rowlayout -->
<div class="kt-row"><p>From another plugin.</p></div>
<!-- /wp:kadence/rowlayout -->`,
    rendered: `<p>Join us for the <strong>parish picnic</strong> on the green, with <em>games</em> for children.</p>
<ul class="wp-block-list"><li>Bring a dish to share<ul class="wp-block-list"><li>Desserts are welcome</li></ul></li><li>Games start at 2</li></ul>
<blockquote class="wp-block-quote"><p>A day for everyone.</p></blockquote>
<figure class="wp-block-image"><img src="${uploads}/06/picnic-768x512.jpg" alt="Families at the picnic" class="wp-image-11"/></figure>
<pre class="wp-block-code"><code>Noon to 4</code></pre>
<figure class="wp-block-embed is-type-video is-provider-vimeo"><div class="wp-block-embed__wrapper"><iframe src="https://player.vimeo.com/video/76979871"></iframe></div></figure>
<div class="kt-row"><p>From another plugin.</p></div>`,
  },
  {
    id: 21,
    type: "post",
    status: "publish",
    title: "Choir news",
    slug: "choir-news",
    link: `${site}/2026/05/choir-news/`,
    date: "2026-05-02 18:30:00",
    categories: ["news"],
    excerpt: "<p>The choir is looking for new voices.</p>",
    content: `The choir is looking for new voices. Rehearsals are on Thursdays.

See the <a href="${site}/2026/06/parish-picnic/">picnic</a> too.`,
    rendered: `<p>The choir is looking for new voices. Rehearsals are on Thursdays.</p>
<p>See the <a href="${site}/2026/06/parish-picnic/">picnic</a> too.</p>`,
  },
  {
    id: 22,
    type: "post",
    status: "future",
    title: "Advent schedule",
    slug: "advent-schedule",
    link: `${site}/2026/12/advent-schedule/`,
    date: "2026-11-29 08:00:00",
    categories: ["news"],
    content: "<!-- wp:paragraph -->\n<p>Advent services are listed here.</p>\n<!-- /wp:paragraph -->",
    rendered: "<p>Advent services are listed here.</p>",
  },
  {
    id: 23,
    type: "post",
    status: "private",
    title: "Staff notes",
    slug: "staff-notes",
    link: `${site}/?p=23`,
    date: "2026-05-03 10:00:00",
    content: "<p>Private.</p>",
    rendered: "<p>Private.</p>",
  },
  {
    id: 40,
    type: "tribe_events",
    status: "publish",
    title: "Bake sale",
    slug: "bake-sale",
    link: `${site}/event/bake-sale/`,
    date: "2026-04-01 10:00:00",
    content: "<p>Cakes.</p>",
    rendered: "<p>Cakes.</p>",
  },
];

interface SampleMedia {
  id: number;
  url: string;
  title: string;
  alt: string;
  caption: string;
}

const MEDIA: SampleMedia[] = [
  { id: 10, url: `${uploads}/05/church-scaled.jpg`, title: "Church", alt: "St. Brendan's church", caption: "" },
  { id: 11, url: `${uploads}/06/picnic.jpg`, title: "Picnic", alt: "Families at the picnic", caption: "" },
  { id: 12, url: `${uploads}/04/unused.png`, title: "Unused", alt: "", caption: "" },
  { id: 13, url: `${uploads}/05/choir.jpg`, title: "Choir", alt: "The choir", caption: "The choir at Easter" },
];

const CATEGORIES = [
  { id: 7, name: "News", slug: "news" },
  { id: 8, name: "Events", slug: "events" },
  { id: 1, name: "Uncategorized", slug: "uncategorized" },
];
const TAGS = [{ id: 9, name: "Summer", slug: "summer" }];

const MENU = [
  { id: 50, label: "Home", type: "custom", url: `${site}/`, object: "custom", objectId: 0, parent: 0, order: 1 },
  { id: 51, label: "", type: "post_type", url: "", object: "page", objectId: 3, parent: 0, order: 2 },
  { id: 52, label: "Staff", type: "post_type", url: "", object: "page", objectId: 4, parent: 51, order: 3 },
  { id: 53, label: "Parish news", type: "taxonomy", url: "", object: "category", objectId: 7, parent: 0, order: 4 },
  {
    id: 54,
    label: "Diocese",
    type: "custom",
    url: "https://diocese.example.org/",
    object: "custom",
    objectId: 0,
    parent: 0,
    order: 5,
  },
];

const cdata = (text: string) => `<![CDATA[${text.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;

function meta(key: string, value: string | number): string {
  return `<wp:postmeta><wp:meta_key>${cdata(key)}</wp:meta_key><wp:meta_value>${cdata(String(value))}</wp:meta_value></wp:postmeta>`;
}

/** St. Brendan's as a WordPress export file. */
export function sampleWordPressExport(): string {
  const items = ITEMS.map((item) => {
    const terms = [
      ...(item.categories ?? []).map((slug) => {
        const category = CATEGORIES.find((candidate) => candidate.slug === slug);
        return `<category domain="category" nicename="${slug}">${cdata(category?.name ?? slug)}</category>`;
      }),
      ...(item.tags ?? []).map((slug) => {
        const tag = TAGS.find((candidate) => candidate.slug === slug);
        return `<category domain="post_tag" nicename="${slug}">${cdata(tag?.name ?? slug)}</category>`;
      }),
    ];
    const comments = Array.from(
      { length: item.comments ?? 0 },
      (_, index) =>
        `<wp:comment><wp:comment_id>${index + 1}</wp:comment_id><wp:comment_content>${cdata("Lovely!")}</wp:comment_content></wp:comment>`,
    );
    return `<item>
<title>${cdata(item.title)}</title>
<link>${item.link}</link>
<dc:creator>${cdata("office")}</dc:creator>
<content:encoded>${cdata(item.content)}</content:encoded>
<excerpt:encoded>${cdata(item.excerpt ?? "")}</excerpt:encoded>
<wp:post_id>${item.id}</wp:post_id>
<wp:post_date>${cdata(item.date)}</wp:post_date>
<wp:post_name>${cdata(item.slug)}</wp:post_name>
<wp:status>${cdata(item.status)}</wp:status>
<wp:post_parent>${item.parent ?? 0}</wp:post_parent>
<wp:menu_order>${item.order ?? 0}</wp:menu_order>
<wp:post_type>${cdata(item.type)}</wp:post_type>
${terms.join("\n")}
${item.image ? meta("_thumbnail_id", item.image) : ""}
${comments.join("\n")}
</item>`;
  });
  const media = MEDIA.map(
    (file) => `<item>
<title>${cdata(file.title)}</title>
<link>${site}/?attachment_id=${file.id}</link>
<excerpt:encoded>${cdata(file.caption)}</excerpt:encoded>
<wp:post_id>${file.id}</wp:post_id>
<wp:status>${cdata("inherit")}</wp:status>
<wp:post_type>${cdata("attachment")}</wp:post_type>
<wp:attachment_url>${cdata(file.url)}</wp:attachment_url>
${file.alt ? meta("_wp_attachment_image_alt", file.alt) : ""}
</item>`,
  );
  const menu = MENU.map(
    (item) => `<item>
<title>${cdata(item.label)}</title>
<wp:post_id>${item.id}</wp:post_id>
<wp:status>${cdata("publish")}</wp:status>
<wp:menu_order>${item.order}</wp:menu_order>
<wp:post_type>${cdata("nav_menu_item")}</wp:post_type>
<category domain="nav_menu" nicename="main-menu">${cdata("Main Menu")}</category>
${meta("_menu_item_type", item.type)}
${meta("_menu_item_menu_item_parent", item.parent)}
${meta("_menu_item_object_id", item.objectId)}
${meta("_menu_item_object", item.object)}
${meta("_menu_item_url", item.url)}
</item>`,
  );
  const reusable = `<item>
<title>${cdata("Welcome note")}</title>
<wp:post_id>30</wp:post_id>
<wp:status>${cdata("publish")}</wp:status>
<wp:post_type>${cdata("wp_block")}</wp:post_type>
<content:encoded>${cdata(REUSABLE)}</content:encoded>
</item>`;
  return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:wfw="http://wellformedweb.org/CommentAPI/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:wp="http://wordpress.org/export/1.2/">
<channel>
<title>St. Brendan&#039;s Parish</title>
<link>${site}</link>
<description>A parish family in Springfield</description>
<language>en-US</language>
<wp:wxr_version>1.2</wp:wxr_version>
<wp:base_site_url>${site}</wp:base_site_url>
<wp:base_blog_url>${site}</wp:base_blog_url>
${CATEGORIES.map((category) => `<wp:category><wp:term_id>${category.id}</wp:term_id><wp:category_nicename>${cdata(category.slug)}</wp:category_nicename><wp:category_parent>${cdata("")}</wp:category_parent><wp:cat_name>${cdata(category.name)}</wp:cat_name></wp:category>`).join("\n")}
${TAGS.map((tag) => `<wp:tag><wp:term_id>${tag.id}</wp:term_id><wp:tag_slug>${cdata(tag.slug)}</wp:tag_slug><wp:tag_name>${cdata(tag.name)}</wp:tag_name></wp:tag>`).join("\n")}
<wp:term><wp:term_id>60</wp:term_id><wp:term_taxonomy>${cdata("nav_menu")}</wp:term_taxonomy><wp:term_slug>${cdata("main-menu")}</wp:term_slug><wp:term_name>${cdata("Main Menu")}</wp:term_name></wp:term>
${[...items, ...media, ...menu, reusable].join("\n")}
</channel>
</rss>
`;
}

/** A tiny PNG, which every sample media file is. */
export const SAMPLE_IMAGE = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73,
  69, 78, 68, 174, 66, 96, 130,
]);

export interface FakeWordPressOptions {
  /** Whether media files allow other sites' requests, which most WordPress sites' don't. */
  mediaCors?: boolean;
  /** Whether the API allows other sites' requests, as WordPress's does. */
  apiCors?: boolean;
}

export interface FakeWordPressResponse {
  status: number;
  headers: Record<string, string>;
  body: string | Uint8Array;
}

/**
 * St. Brendan's as WordPress's API answers it, at `SAMPLE_WORDPRESS_URL`:
 * `handle()` for end-to-end tests' routes, `fetch` for unit tests.
 */
export function fakeWordPress(options: FakeWordPressOptions = {}) {
  const { mediaCors = false, apiCors = true } = options;
  const shown = ITEMS.filter((item) => item.status === "publish" && (item.type === "page" || item.type === "post"));
  const rendered = (text: string) => ({ rendered: text });
  const termId = (list: { id: number; slug: string }[], slug: string) =>
    list.find((term) => term.slug === slug)?.id ?? 0;
  const json = (data: unknown, extra: Record<string, string> = {}): FakeWordPressResponse => ({
    status: 200,
    headers: {
      "content-type": "application/json",
      ...(apiCors && {
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "X-WP-Total, X-WP-TotalPages",
      }),
      ...extra,
    },
    body: JSON.stringify(data),
  });
  const items = (type: string) =>
    shown
      .filter((item) => item.type === type)
      .map((item) => ({
        id: item.id,
        date: item.date.replace(" ", "T"),
        slug: item.slug,
        status: item.status,
        link: item.link,
        title: rendered(item.title.replace("'", "&#8217;")),
        content: rendered(item.rendered),
        excerpt: rendered(item.excerpt ?? ""),
        parent: item.parent ?? 0,
        menu_order: item.order ?? 0,
        featured_media: item.image ?? 0,
        ...(type === "post" && {
          categories: (item.categories ?? []).map((slug) => termId(CATEGORIES, slug)),
          tags: (item.tags ?? []).map((slug) => termId(TAGS, slug)),
        }),
      }));
  const routes: Record<string, () => unknown> = {
    "/": () => ({
      name: "St. Brendan&#039;s Parish",
      description: "A parish family in Springfield",
      url: site,
      home: site,
      namespaces: ["oembed/1.0", "wp/v2"],
    }),
    "/wp/v2/pages": () => items("page"),
    "/wp/v2/posts": () => items("post"),
    "/wp/v2/categories": () =>
      CATEGORIES.map((category) => ({ ...category, parent: 0, link: `${site}/category/${category.slug}/` })),
    "/wp/v2/tags": () => TAGS.map((tag) => ({ ...tag, link: `${site}/tag/${tag.slug}/` })),
    "/wp/v2/media": () =>
      MEDIA.map((file) => ({
        id: file.id,
        source_url: file.url,
        alt_text: file.alt,
        title: rendered(file.title),
        caption: rendered(file.caption ? `<p>${file.caption}</p>` : ""),
      })),
  };

  const handle = (url: string): FakeWordPressResponse => {
    const parsed = new URL(url);
    if (parsed.origin !== site) return { status: 404, headers: {}, body: "" };
    if (parsed.pathname.startsWith("/wp-content/uploads/")) {
      return {
        status: 200,
        headers: { "content-type": "image/png", ...(mediaCors && { "access-control-allow-origin": "*" }) },
        body: SAMPLE_IMAGE,
      };
    }
    const route = parsed.pathname.startsWith("/wp-json") ? parsed.pathname.slice("/wp-json".length) || "/" : undefined;
    const answer = route !== undefined ? routes[route.replace(/(.)\/$/, "$1")] : undefined;
    if (!answer) return { ...json({ code: "rest_no_route" }), status: 404 };
    const page = Number(parsed.searchParams.get("page") ?? "1");
    if (page > 1) return { ...json({ code: "rest_post_invalid_page_number" }), status: 400 };
    const data = answer();
    return json(data, Array.isArray(data) ? { "x-wp-total": String(data.length), "x-wp-totalpages": "1" } : {});
  };

  return {
    handle,
    fetch: async (url: string) => {
      const answer = handle(url);
      return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        headers: { get: (name: string) => answer.headers[name.toLowerCase()] ?? null },
        json: async () =>
          JSON.parse(typeof answer.body === "string" ? answer.body : new TextDecoder().decode(answer.body)) as unknown,
        arrayBuffer: async () =>
          (typeof answer.body === "string" ? new TextEncoder().encode(answer.body) : answer.body).slice().buffer,
      };
    },
  };
}
