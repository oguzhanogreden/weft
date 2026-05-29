/**
 * Recipe: List Rendering
 *
 * This recipe demonstrates patterns for rendering lists in effect-ui,
 * including static arrays, stream-based lists, and Fragment usage.
 */

import { h } from "@effect-ui/core";
import { mount } from "@effect-ui/dom/client";
import { Effect, Schedule, Stream } from "effect";

// ============================================================================
// Example 1: Static Array Rendering
// ============================================================================

const StaticList = () => {
  const items = ["Apple", "Banana", "Cherry", "Date", "Elderberry"];

  return h.ul(
    {},
    items.map((item) => h.li({}, item)),
  );
};

// ============================================================================
// Example 2: Fragment for Table Rows
// ============================================================================

interface User {
  name: string;
  role: string;
  status: string;
}

const TableRow = ({ user }: { user: User }) =>
  h.fragment([h.td({}, user.name), h.td({}, user.role), h.td({}, user.status)]);

const UserTable = () => {
  const users: User[] = [
    { name: "Alice", role: "Admin", status: "Active" },
    { name: "Bob", role: "User", status: "Active" },
    { name: "Charlie", role: "User", status: "Inactive" },
  ];

  return h.table({}, [
    h.thead({}, [h.tr({}, [h.th({}, "Name"), h.th({}, "Role"), h.th({}, "Status")])]),
    h.tbody(
      {},
      users.map((user) => h.tr({}, [TableRow({ user })])),
    ),
  ]);
};

// ============================================================================
// Example 3: Stream of Arrays (Growing List)
// ============================================================================

const GrowingList = () => {
  const itemsStream = Stream.iterate(["Item 1"], (items) => [
    ...items,
    `Item ${items.length + 1}`,
  ]).pipe(Stream.schedule(Schedule.spaced("1 second")), Stream.take(5));

  return h.ul({}, [Stream.map(itemsStream, (items) => items.map((item) => h.li({}, item)))]);
};

// ============================================================================
// Example 4: Nested Iterables
// ============================================================================

const NestedList = () => {
  const categories = [
    { name: "Fruits", items: ["Apple", "Banana"] },
    { name: "Vegetables", items: ["Carrot", "Broccoli"] },
    { name: "Dairy", items: ["Milk", "Cheese", "Yogurt"] },
  ];

  return h.div(
    {},
    categories.map((category) =>
      h.div({ style: { marginBottom: "1rem" } }, [
        h.strong({}, category.name),
        h.ul(
          {},
          category.items.map((item) => h.li({}, item)),
        ),
      ]),
    ),
  );
};

// ============================================================================
// Example 5: Badges with Fragment
// ============================================================================

const TagList = ({ tags }: { tags: string[] }) =>
  h.fragment(
    tags.map((tag, i) =>
      h.span({ class: `badge ${["blue", "green", "purple"][i % 3] ?? "blue"}` }, tag),
    ),
  );

const BadgeDemo = () => {
  const skills = ["TypeScript", "Effect", "React", "Node.js", "GraphQL"];

  return h.div({}, [h.p({}, "Skills: "), TagList({ tags: skills })]);
};

// ============================================================================
// Example 6: Live Counter List
// ============================================================================

const LiveCounterList = () => {
  const counters = [1, 2, 3].map((id) => ({
    id,
    valueStream: Stream.iterate(0, (n) => n + 1).pipe(
      Stream.schedule(Schedule.spaced(`${id * 500} millis`)),
      Stream.take(10),
    ),
  }));

  return h.ul(
    {},
    counters.map((counter) => h.li({}, [`Counter ${counter.id}: `, counter.valueStream])),
  );
};

// ============================================================================
// App
// ============================================================================

const App = () =>
  h.div({}, [
    h.h1({}, "List Rendering"),

    h.section({}, [
      h.h2({}, "1. Static Array"),
      h.p({}, "Simple array.map() to render items."),
      StaticList(),
    ]),

    h.section({}, [
      h.h2({}, "2. Fragment for Table Rows"),
      h.p({}, "Fragment returns multiple td elements without wrapper."),
      UserTable(),
    ]),

    h.section({}, [
      h.h2({}, "3. Growing List (Stream of Arrays)"),
      h.p({}, "List grows over time via stream."),
      GrowingList(),
    ]),

    h.section({}, [
      h.h2({}, "4. Nested Iterables"),
      h.p({}, "Arrays within arrays flatten correctly."),
      NestedList(),
    ]),

    h.section({}, [
      h.h2({}, "5. Badges with Fragment"),
      h.p({}, "Fragment component returns inline badges."),
      BadgeDemo(),
    ]),

    h.section({}, [
      h.h2({}, "6. Live Counters"),
      h.p({}, "Each list item has its own reactive stream."),
      LiveCounterList(),
    ]),
  ]);

void Effect.runPromise(mount(App(), document.getElementById("root")!));
