import {
  type EditorList,
  type EditorRole,
  EditorsError,
  GitApiError,
  type SiteEditor,
  type SiteEditors,
} from "@goodfellow-cms/core";
import { type ApiOptions, gitlabJson, gitlabRequest } from "./api.js";

/** GitLab's roles: Developer, Maintainer and Owner. */
const DEVELOPER = 30;
const MAINTAINER = 40;

interface Member {
  id: number;
  username: string;
  name?: string;
  avatar_url?: string;
  access_level: number;
}

interface Invitation {
  invite_email: string;
  access_level: number;
}

interface ProtectedBranch {
  push_access_levels?: Array<{ access_level: number | null }>;
}

const MEMBER = "member:";
const INVITATION = "invitation:";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME = /^[\w][\w.-]*$/;

function roleOf(level: number): EditorRole {
  if (level >= MAINTAINER) return "owner";
  return level >= DEVELOPER ? "editor" : "viewer";
}

function levelOf(role: Exclude<EditorRole, "viewer">): number {
  return role === "owner" ? MAINTAINER : DEVELOPER;
}

function notAllowed(error: unknown): never {
  if (error instanceof GitApiError && (error.status === 401 || error.status === 403)) {
    throw new EditorsError("not-allowed", "Changing editors on GitLab needs the Maintainer role in the project.");
  }
  throw error;
}

/**
 * The project's members. Editors are Developers, and owners Maintainers,
 * who can also add and remove members. GitLab protects the main branch so
 * only Maintainers can publish to it, until `letEditorsPublish()` lets
 * Developers publish too.
 */
export function gitlabEditors(api: ApiOptions, project: string, branch: string, username: string): SiteEditors {
  const id = encodeURIComponent(project);
  const base = `/projects/${id}`;
  const protectedPath = `${base}/protected_branches/${encodeURIComponent(branch)}`;

  async function all<T>(path: string): Promise<T[]> {
    const found: T[] = [];
    for (let page = 1; page <= 10; page++) {
      const items = await gitlabJson<T[]>(api, `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      found.push(...items);
      if (items.length < 100) break;
    }
    return found;
  }

  return {
    invitesByEmail: true,

    async list(): Promise<EditorList> {
      const [everyone, direct] = await Promise.all([
        all<Member>(`${base}/members/all`),
        all<Member>(`${base}/members`),
      ]);
      const own = new Set(direct.map((member) => member.id));
      const self = everyone.find((member) => member.username.toLowerCase() === username.toLowerCase());
      const manage = (self?.access_level ?? 0) >= MAINTAINER;
      const invitations = manage ? await all<Invitation>(`${base}/invitations`).catch(() => []) : [];
      const protection = await gitlabRequest(api, protectedPath, { allow: [404] });
      const levels = protection.ok ? (((await protection.json()) as ProtectedBranch).push_access_levels ?? []) : [];
      const editorsCanPublish =
        !protection.ok || levels.some((level) => level.access_level !== null && level.access_level <= DEVELOPER);

      return {
        editors: [
          ...everyone.map((member) => ({
            id: `${MEMBER}${member.id}`,
            login: member.username,
            name: member.name,
            avatarUrl: member.avatar_url,
            role: roleOf(member.access_level),
            ...(!own.has(member.id) && { inherited: true }),
            ...(member.id === self?.id && { self: true }),
          })),
          ...invitations.map(
            (invitation): SiteEditor => ({
              id: `${INVITATION}${invitation.invite_email}`,
              email: invitation.invite_email,
              role: roleOf(invitation.access_level),
              invited: true,
            }),
          ),
        ],
        manage: manage ? "yes" : "no",
        editorsCanPublish,
      };
    },

    async invite(who, role) {
      const name = who.trim().replace(/^@/, "");
      if (name.includes("@")) {
        if (!EMAIL.test(name)) throw new EditorsError("invalid", "That isn't an email address.");
        const result = await gitlabJson<{ status: string; message?: Record<string, string> | string }>(
          api,
          `${base}/invitations`,
          { method: "POST", body: { email: name, access_level: levelOf(role) } },
        ).catch(notAllowed);
        if (result.status !== "success") {
          const message = typeof result.message === "string" ? result.message : Object.values(result.message ?? {})[0];
          if (/already/i.test(message ?? "")) throw new EditorsError("already", "They've already been invited.");
          throw new EditorsError("invalid", `GitLab didn't accept the invitation: ${message ?? result.status}`);
        }
        return;
      }
      if (!USERNAME.test(name)) throw new EditorsError("invalid", "That isn't a GitLab username or email address.");
      const [user] = await gitlabJson<Array<{ id: number }>>(api, `/users?${new URLSearchParams({ username: name })}`);
      if (!user) throw new EditorsError("not-found", `There's no GitLab account named ${name}.`);
      try {
        await gitlabRequest(api, `${base}/members`, {
          method: "POST",
          body: { user_id: user.id, access_level: levelOf(role) },
        });
      } catch (error) {
        if (error instanceof GitApiError && error.status === 409) {
          throw new EditorsError("already", `${name} already edits the site.`);
        }
        notAllowed(error);
      }
    },

    async setRole(editor, role) {
      const path = editor.id.startsWith(INVITATION)
        ? `${base}/invitations/${encodeURIComponent(editor.id.slice(INVITATION.length))}`
        : `${base}/members/${editor.id.slice(MEMBER.length)}`;
      await gitlabRequest(api, path, { method: "PUT", body: { access_level: levelOf(role) } }).catch(notAllowed);
    },

    async remove(editor) {
      const path = editor.id.startsWith(INVITATION)
        ? `${base}/invitations/${encodeURIComponent(editor.id.slice(INVITATION.length))}`
        : `${base}/members/${editor.id.slice(MEMBER.length)}`;
      await gitlabRequest(api, path, { method: "DELETE" }).catch(notAllowed);
    },

    async letEditorsPublish() {
      // GitLab's free plan can only choose who may push when a branch is protected, so the
      // branch is protected again, with Developers allowed to push and nobody to force-push.
      // Developers may merge too, which adding pipeline schedules for scheduled changes needs.
      const protect = (level: number) =>
        gitlabRequest(api, `${base}/protected_branches`, {
          method: "POST",
          body: { name: branch, push_access_level: level, merge_access_level: level, allow_force_push: false },
        });
      await gitlabRequest(api, protectedPath, { method: "DELETE", allow: [404] }).catch(notAllowed);
      try {
        await protect(DEVELOPER);
      } catch (error) {
        // Put the protection back as it was, rather than leave the branch unprotected.
        await protect(MAINTAINER).catch(() => undefined);
        notAllowed(error);
      }
    },
  };
}
