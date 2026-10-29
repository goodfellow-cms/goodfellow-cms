/**
 * Comments on GitHub: the repository Giscus keeps them in, made or found
 * with REST, and its discussions read and moderated with GraphQL. Uses the
 * comments token where one is in use, and otherwise the site's own sign-in,
 * which reaches the repository where it's a token for every repository.
 */
import {
  type CommentsAccess,
  CommentsError,
  type CommentsPlace,
  type CommentsRepository,
  type CommentThread,
  type CommentThreads,
  GISCUS_APP_URL,
  GitApiError,
  type HideReason,
  SignInError,
  type SiteComment,
  type SiteComments,
  type TokenLink,
} from "@goodfellow-cms/core";
import { type ApiOptions, githubJson, repoPath } from "./api.js";

/** How many pages' discussions one call lists, and how many comments and replies each brings. */
const THREADS_PER_PAGE = 20;
const COMMENTS_PER_THREAD = 50;
const REPLIES_PER_COMMENT = 50;

const CLASSIFIERS: Record<HideReason, string> = { spam: "SPAM", abuse: "ABUSE", "off-topic": "OFF_TOPIC" };

/** The category Giscus recommends, where only it and the repository's owners can start discussions. */
const ANNOUNCEMENTS = "announcements";

interface RepositoryAnswer {
  full_name: string;
  html_url: string;
  node_id: string;
  private: boolean;
  has_discussions?: boolean;
  owner: { id: number; login: string };
  permissions?: { admin?: boolean };
}

interface CommentNode {
  id: string;
  url: string;
  bodyText: string;
  createdAt: string;
  isMinimized: boolean;
  minimizedReason?: string | null;
  author?: { login: string; url: string; avatarUrl?: string } | null;
  replies?: { nodes: CommentNode[] };
}

interface ThreadNode {
  id: string;
  title: string;
  url: string;
  locked: boolean;
  updatedAt: string;
  comments: { nodes: CommentNode[] };
}

const COMMENT_FIELDS = `id url bodyText createdAt isMinimized minimizedReason author { login url avatarUrl }`;

const THREADS_QUERY = `query ($owner: String!, $name: String!, $category: ID!, $after: String) {
  repository(owner: $owner, name: $name) {
    discussions(first: ${THREADS_PER_PAGE}, after: $after, categoryId: $category, orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title url locked updatedAt
        comments(first: ${COMMENTS_PER_THREAD}) {
          nodes { ${COMMENT_FIELDS} replies(first: ${REPLIES_PER_COMMENT}) { nodes { ${COMMENT_FIELDS} } } }
        }
      }
    }
  }
}`;

const CATEGORIES_QUERY = `query ($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    discussionCategories(first: 25) { nodes { id name slug } }
  }
}`;

function comment(node: CommentNode): SiteComment {
  return {
    id: node.id,
    author: {
      // A deleted account's comments have no author; GitHub calls it "ghost".
      login: node.author?.login ?? "ghost",
      url: node.author?.url ?? "https://github.com/ghost",
      ...(node.author?.avatarUrl && { avatarUrl: node.author.avatarUrl }),
    },
    text: node.bodyText,
    createdAt: node.createdAt,
    url: node.url,
    hidden: node.isMinimized,
    ...(node.isMinimized && node.minimizedReason && { hiddenReason: node.minimizedReason.toLowerCase() }),
    replies: (node.replies?.nodes ?? []).map(comment),
  };
}

/** Giscus's install page, for the account the repository is in. */
function installUrl(ownerId: number): string {
  return `${GISCUS_APP_URL}/installations/new/permissions?target_id=${ownerId}`;
}

function isRefused(error: unknown): boolean {
  return error instanceof SignInError || (error instanceof GitApiError && [403, 404].includes(error.status));
}

/**
 * Where to create a token for comments: a classic one with \`public_repo\`,
 * which can create a public repository and moderate its discussions. A
 * fine-grained token can't reach a repository that doesn't exist yet.
 */
export function commentsTokenLink(webUrl: string, siteRepo: string): TokenLink {
  const query = new URLSearchParams({ scopes: "public_repo", description: `Goodfellow comments for ${siteRepo}` });
  return { url: `${webUrl}/settings/tokens/new?${query}`, label: "comments.token.create" };
}

export function githubComments(base: ApiOptions, siteRepo: string, tokenLink: TokenLink): SiteComments {
  let own: ApiOptions | undefined;
  const api = () => own ?? base;

  async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const answer = await githubJson<{ data?: T; errors?: Array<{ type?: string; message: string }> }>(
      api(),
      "/graphql",
      { method: "POST", body: { query, variables } },
    ).catch((error: unknown) => {
      if (isRefused(error)) throw new CommentsError("no-access", "GitHub refused the sign-in for comments.");
      throw error;
    });
    const error = answer.errors?.[0];
    if (error) {
      if (
        error.type === "FORBIDDEN" ||
        error.type === "NOT_FOUND" ||
        /not have permission|resource not accessible/i.test(error.message)
      ) {
        throw new CommentsError("no-access", error.message);
      }
      throw new Error(error.message);
    }
    return answer.data as T;
  }

  /** The repository's category for announcements, or else its first, as Giscus needs. */
  async function placeOf(found: RepositoryAnswer): Promise<CommentsRepository> {
    const [owner = "", name = ""] = found.full_name.split("/");
    let categories: Array<{ id: string; name: string; slug: string }> = [];
    // GitHub makes the usual categories as Discussions are turned on, which can take a moment.
    for (let attempt = 0; attempt < 3; attempt++) {
      const data = await graphql<{
        repository: { discussionCategories: { nodes: Array<{ id: string; name: string; slug: string }> } } | null;
      }>(CATEGORIES_QUERY, { owner, name });
      categories = data.repository?.discussionCategories.nodes ?? [];
      if (categories.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
    const category = categories.find((candidate) => candidate.slug === ANNOUNCEMENTS) ?? categories[0];
    if (!category) {
      throw new CommentsError(
        "no-category",
        "The repository's Discussions have no categories yet.",
        `${found.html_url}/discussions`,
      );
    }
    return {
      repo: found.full_name,
      repoId: found.node_id,
      category: category.name,
      categoryId: category.id,
      webUrl: found.html_url,
      installUrl: installUrl(found.owner.id),
    };
  }

  /** Turns Discussions on where they're off, which needs the repository's admin. */
  async function withDiscussions(found: RepositoryAnswer): Promise<RepositoryAnswer> {
    if (found.has_discussions) return found;
    if (found.permissions?.admin === false) {
      throw new CommentsError("no-discussions", "Discussions are off.", `${found.html_url}/settings`);
    }
    return githubJson<RepositoryAnswer>(api(), `/repos/${repoPath(found.full_name)}`, {
      method: "PATCH",
      body: { has_discussions: true },
    }).catch((error: unknown) => {
      if (isRefused(error)) {
        throw new CommentsError("no-discussions", "Discussions are off.", `${found.html_url}/settings`);
      }
      throw error;
    });
  }

  async function mutate(mutation: string, input: Record<string, unknown>): Promise<void> {
    await graphql(
      `mutation ($input: ${mutation}Input!) { ${mutation[0]?.toLowerCase()}${mutation.slice(1)}(input: $input) { clientMutationId } }`,
      {
        input,
      },
    );
  }

  const access: CommentsAccess = {
    tokenLink,
    get active() {
      return own !== undefined;
    },
    async applyToken(token) {
      const candidate = { ...base, token: token.trim() };
      try {
        await githubJson(candidate, "/user");
      } catch (error) {
        if (isRefused(error)) throw new CommentsError("no-access", "GitHub didn't accept this token.");
        throw error;
      }
      own = candidate;
    },
    forget() {
      own = undefined;
    },
  };

  return {
    access,

    async create(name, description) {
      const wanted = name.trim();
      if (!/^[\w.-]+$/.test(wanted) || /^\.+$/.test(wanted)) {
        throw new CommentsError("name-invalid", "That can't be a repository's name.");
      }
      const user = await githubJson<{ login: string }>(api(), "/user").catch((error: unknown) => {
        if (isRefused(error)) throw new CommentsError("no-access", "GitHub refused the sign-in for comments.");
        throw error;
      });
      // Beside the site's repository: in its organization, or the person's own account.
      const siteOwner = siteRepo.split("/")[0] ?? "";
      const path =
        siteOwner.toLowerCase() === user.login.toLowerCase()
          ? "/user/repos"
          : `/orgs/${encodeURIComponent(siteOwner)}/repos`;
      const made = await githubJson<RepositoryAnswer>(api(), path, {
        method: "POST",
        body: {
          name: wanted,
          description,
          private: false,
          has_discussions: true,
          has_issues: false,
          has_projects: false,
          has_wiki: false,
          auto_init: true,
        },
      }).catch((error: unknown) => {
        if (error instanceof GitApiError && error.status === 422) {
          throw new CommentsError("name-taken", "There's already a repository with that name.");
        }
        if (isRefused(error)) {
          throw new CommentsError("no-access", "This sign-in can't create repositories there.");
        }
        throw error;
      });
      return placeOf(await withDiscussions(made));
    },

    async find(repo) {
      const wanted = repo
        .trim()
        .replace(/^https:\/\/github\.com\//i, "")
        .replace(/\/+$/, "");
      if (!/^[\w.-]+\/[\w.-]+$/.test(wanted)) throw new CommentsError("not-found", "That isn't a repository's name.");
      const found = await githubJson<RepositoryAnswer>(api(), `/repos/${repoPath(wanted)}`).catch((error: unknown) => {
        if (isRefused(error)) throw new CommentsError("not-found", "GitHub has no such repository for this sign-in.");
        throw error;
      });
      if (found.private)
        throw new CommentsError("not-public", "The repository is private.", `${found.html_url}/settings`);
      return placeOf(await withDiscussions(found));
    },

    async threads(place: CommentsPlace, next?: string): Promise<CommentThreads> {
      const [owner = "", name = ""] = place.repo.split("/");
      const data = await graphql<{
        repository: {
          discussions: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ThreadNode[] };
        } | null;
      }>(THREADS_QUERY, { owner, name, category: place.categoryId, after: next ?? null });
      if (!data.repository) throw new CommentsError("not-found", "GitHub has no such repository for this sign-in.");
      const { pageInfo, nodes } = data.repository.discussions;
      const threads: CommentThread[] = nodes.map((node) => ({
        id: node.id,
        title: node.title,
        url: node.url,
        locked: node.locked,
        updatedAt: node.updatedAt,
        comments: node.comments.nodes.map(comment),
      }));
      return { threads, ...(pageInfo.hasNextPage && pageInfo.endCursor && { next: pageInfo.endCursor }) };
    },

    async hide(commentId, reason) {
      await mutate("MinimizeComment", { subjectId: commentId, classifier: CLASSIFIERS[reason] });
    },
    async show(commentId) {
      await mutate("UnminimizeComment", { subjectId: commentId });
    },
    async remove(commentId) {
      await mutate("DeleteDiscussionComment", { id: commentId });
    },
    async lock(threadId) {
      await mutate("LockLockable", { lockableId: threadId });
    },
    async unlock(threadId) {
      await mutate("UnlockLockable", { lockableId: threadId });
    },
  };
}
