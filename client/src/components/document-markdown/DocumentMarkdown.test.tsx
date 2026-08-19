import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DocumentMarkdown } from "./DocumentMarkdown";

afterEach(cleanup);

/**
 * AC-34. The point of this renderer is that a document does not collapse into
 * body text, so every assertion here is about a block element existing AND
 * being styled differently from the paragraph beside it — the vendored
 * `<Markdown>` primitive emits the same tags and leaves them all looking like a
 * `<p>`, which is precisely the failure this file has to catch.
 */
describe("DocumentMarkdown", () => {
  it("renders headings, lists, code blocks and tables distinguishably from body text", () => {
    render(
      <DocumentMarkdown>
        {[
          "# Title",
          "",
          "## H",
          "",
          "- a",
          "- b",
          "",
          "Body text.",
          "",
          "```ts",
          "const x = 1;",
          "```",
          "",
          "| Criterion | Verify |",
          "| --- | --- |",
          "| AC-34 | test |",
        ].join("\n")}
      </DocumentMarkdown>,
    );

    const h2 = screen.getByRole("heading", { level: 2, name: "H" });
    const li = screen.getByText("a");
    const paragraph = screen.getByText("Body text.");

    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument();
    expect(h2).toBeInTheDocument();
    expect(li.tagName).toBe("LI");
    expect(li.closest("ul")).not.toBeNull();

    // Not styled identically to a paragraph: the heading is heavier and the
    // list item is indented by its list. Comparing against the paragraph rather
    // than against a fixed value is what makes this a test of the DIFFERENCE,
    // which is what the requirement is about.
    expect(h2.style.fontWeight).not.toBe(paragraph.style.fontWeight);
    expect(h2.style.fontSize).not.toBe(paragraph.style.fontSize);
    expect(li.closest("ul")!.style.paddingLeft).not.toBe("");

    // A fenced block is a real <pre>, recessed on its own surface.
    const pre = screen.getByText("const x = 1;").closest("pre");
    expect(pre).not.toBeNull();
    expect(pre!.style.background).not.toBe(paragraph.style.background);

    // The table is the element the inline primitive cannot express at all.
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Criterion" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "AC-34" })).toBeInTheDocument();
  });

  it("renders nothing for an empty document and strips a javascript: link", () => {
    const { container, rerender } = render(<DocumentMarkdown>{""}</DocumentMarkdown>);
    expect(container).toBeEmptyDOMElement();

    // Belt and braces: react-markdown's own `urlTransform` already empties a
    // `javascript:` href, and the component's guard catches anything that gets
    // past it. The assertion is on the outcome — no such scheme reaches the DOM.
    rerender(<DocumentMarkdown>{"[click](javascript:alert(1))"}</DocumentMarkdown>);
    expect(screen.getByText("click").getAttribute("href") ?? "").not.toContain("javascript:");
  });
});
