import { h } from "@effect-ui/core";
import { Schema } from "effect";
import { href, layout, route, router } from "~/index";

// ── Page component args are typed from the route's own path/query schemas ──────

const userRoute = route(
  "users/:id",
  { path: { id: Schema.NumberFromString }, query: { tab: Schema.optional(Schema.String) } },
  ({ path, query }) => {
    // Should compile — `path.id` is a number, `query.tab` is `string | undefined`.
    const _id: number = path.id;
    const _tab: string | undefined = query.tab;
    return h.div({}, `${_id}${_tab ?? ""}`);
  },
);

const aboutRoute = route("about", () => h.div({}, "about"));

route("users/:id", { path: { id: Schema.NumberFromString } }, ({ path }) => {
  // @ts-expect-error — `path.id` is a number, not a string.
  const _wrong: string = path.id;
  return h.div({}, _wrong);
});

// Layout render receives the outlet plus typed path args.
const shell = layout("", (outlet) => h.div({ class: "shell" }, [outlet]), [userRoute, aboutRoute]);

router(shell, { notFound: () => h.h1({}, "404") });

// ── href argument requiredness (H1/H4) ────────────────────────────────────────

// Should compile — path required, query optional.
href(userRoute, { path: { id: 1 } });
href(userRoute, { path: { id: 1 }, query: { tab: "x" } });

// Should compile — a no-param/no-query route needs no argument.
href(aboutRoute);

// @ts-expect-error — path is required when the route has path params.
href(userRoute, {});

// @ts-expect-error — `id` must be a number.
href(userRoute, { path: { id: "not-a-number" } });

// @ts-expect-error — unknown query key.
href(userRoute, { path: { id: 1 }, query: { nope: "x" } });
