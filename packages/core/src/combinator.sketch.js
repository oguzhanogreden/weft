/**
 * Sketch: combinator API in a realistic UI tree.
 * Nothing here is real — custom components and helpers are made up.
 * .js so the type checker stays out of the way.
 */

import { h, node } from "./combinator";
import {
  TextField,
  Select,
  Checkbox,
  RadioGroup,
  FormField,
  Avatar,
  Badge,
  Divider,
  Spinner,
  ErrorMessage,
} from "./components";
import { Stream, Effect, pipe } from "effect";

// ---------------------------------------------------------------------------
// Imagined reactive state / services
// ---------------------------------------------------------------------------

const user = Stream.make({
  id: "u1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  role: "admin",
});
const isSaving = Stream.make(false);
const saveError = Stream.make(null);
const roles = Effect.succeed([
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
]);
const avatarUrl = Stream.map(user, (u) => `/avatars/${u.id}.jpg`);
const displayName = Stream.map(user, (u) => u.name);
const isAdmin = Stream.map(user, (u) => u.role === "admin");

// ---------------------------------------------------------------------------
// Sketch
// ---------------------------------------------------------------------------

export const UserProfilePage = () =>
  h.div({ id: "user-profile", className: "page" }, [
    PageHeader,
    h.section({ className: "content" }, [UserProfileForm, DangerZone]),
  ]);

const PageHeader = h.header({ className: "page-header" }, [
  h.h2({}, "User Profile"),
  Badge({
    className: "role-badge",
    children: node(Stream.map(user, (u) => (u.role === "admin" ? "Admin" : "Member"))),
  }),
]);

const UserProfileForm = h.form({ id: "user-form", className: "card", onSubmit: handleSave }, [
  h.section({ className: "form-header" }, [
    Avatar({ src: avatarUrl, alt: displayName, className: "avatar--lg" }),
    h.div({ className: "form-header__meta" }, [
      h.span({ className: "form-header__name" }, [node(displayName)]),
      h.span({ className: "form-header__id" }, [node(Stream.map(user, (u) => `#${u.id}`))]),
    ]),
  ]),

  Divider(),

  h.section({ className: "form-body" }, [
    FormField({
      label: "Full name",
      error: fieldError("name"),
      children: [
        TextField({
          name: "name",
          placeholder: "Ada Lovelace",
          value: Stream.map(user, (u) => u.name),
          onChange: handleFieldChange("name"),
        }),
      ],
    }),

    FormField({
      label: "Email address",
      error: fieldError("email"),
      children: [
        TextField({
          name: "email",
          type: "email",
          placeholder: "ada@example.com",
          value: Stream.map(user, (u) => u.email),
          onChange: handleFieldChange("email"),
        }),
      ],
    }),

    FormField({
      label: "Role",
      children: [
        Select({
          name: "role",
          value: Stream.map(user, (u) => u.role),
          options: node(roles),
          onChange: handleFieldChange("role"),
        }),
      ],
    }),

    FormField({
      label: "Notifications",
      children: [
        h.ul({ className: "checklist" }, [
          h.li([
            Checkbox({
              name: "notify_email",
              checked: Stream.map(user, (u) => u.notifyEmail),
              onChange: handleFieldChange("notifyEmail"),
              children: "Email notifications",
            }),
          ]),
          h.li([
            Checkbox({
              name: "notify_push",
              checked: Stream.map(user, (u) => u.notifyPush),
              onChange: handleFieldChange("notifyPush"),
              children: "Push notifications",
            }),
          ]),
        ]),
      ],
    }),

    FormField({
      label: "Preferred contact",
      children: [
        RadioGroup({
          name: "contact_preference",
          value: Stream.map(user, (u) => u.contactPreference),
          onChange: handleFieldChange("contactPreference"),
          options: [
            { value: "email", label: "Email" },
            { value: "phone", label: "Phone" },
            { value: "none", label: "None" },
          ],
        }),
      ],
    }),
  ]),

  node(Stream.map(saveError, (err) => (err ? ErrorMessage({ message: err.message }) : null))),

  h.footer({ className: "form-footer" }, [
    h.button({ type: "button", className: "btn btn--ghost", onClick: handleCancel }, "Cancel"),
    h.button(
      {
        type: "submit",
        className: "btn btn--primary",
        disabled: isSaving,
        ariaLabel: "Save profile changes",
      },
      [
        node(Stream.map(isSaving, (saving) => (saving ? Spinner() : null))),
        node(Stream.map(isSaving, (saving) => (saving ? "Saving…" : "Save changes"))),
      ],
    ),
  ]),
]);

// Only visible to admins
const DangerZone = node(
  Stream.map(isAdmin, (admin) =>
    !admin
      ? null
      : h.section({ className: "card card--danger" }, [
          h.h2({}, "Danger zone"),
          h.p({}, "Permanently delete this account and all associated data."),
          h.button(
            { className: "btn btn--danger", onClick: handleDeleteAccount },
            "Delete account",
          ),
        ]),
  ),
);

// ---------------------------------------------------------------------------
// Imagined handlers (Effect-based)
// ---------------------------------------------------------------------------

const handleSave = (e) =>
  pipe(
    e.preventDefault(),
    Effect.andThen(UserService.save(formState)),
    Effect.catchTag("ValidationError", (err) => SubscriptionRef.set(saveError, err)),
  );

const handleFieldChange = (field) => (value) =>
  SubscriptionRef.update(formState, (s) => ({ ...s, [field]: value }));

const handleCancel = () =>
  Effect.andThen(Router.back(), SubscriptionRef.set(formState, originalState));

const handleDeleteAccount = () =>
  pipe(
    Dialog.confirm("Are you sure? This cannot be undone."),
    Effect.andThen(UserService.delete(user.id)),
    Effect.andThen(Router.push("/users")),
  );

const fieldError = (field) =>
  pipe(
    saveError,
    Stream.map((err) => err?.fields?.[field] ?? null),
  );
