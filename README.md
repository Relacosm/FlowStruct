# FlowStruct

Paste code, get a real control-flow chart — decision diamonds, loops with
loop-back edges, functions as collapsible containers, and `return`/`break`/
`continue` drawn as jump edges to where they actually go.

Supports **Python, JavaScript, Java, Ruby, C++** (heuristic parser).

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

## Build for production

```bash
npm run build      # outputs to dist/
npm run preview    # preview the built site
```

## Project structure

```
src/
  CodeFlowVisualizer.jsx   # UI: canvas, pan/zoom, sidebar, export
  flowEngine.js            # parsing: mask → depth → block tree → clean labels
  layoutEngine.js          # tidy-tree layout + jump-edge routing
  samples.js               # quick-load code samples
  App.css / index.css      # styles
  main.jsx                 # entry point
```

## How it works

1. **Mask** strings/comments so braces inside them don't break nesting.
2. **Depth**: indentation (Python), `end`-stack (Ruby), or statement-splitting
   on `{ } ;` outside parens (JS/Java/C++) — so `if (x) { break; }` on one line
   still nests correctly.
3. **Tree**: build real parent/child blocks (if/elif/else, loops, functions).
4. **Labels**: extract the meaningful part — `if (n > 0) {` becomes `n > 0?`,
   `def check(x):` becomes `check(x)`.
5. **Layout**: recursive tidy-tree — branches sit side by side and merge back;
   loops draw a loop-back edge; jumps route to loop exit / loop head / function end.

It's a heuristic parser, not a full compiler — deeply unusual code can have edge
cases. For bulletproof JS specifically, swap the JS front-end for `acorn`.

## Controls

- **scroll** = zoom, **drag** = pan, **Fit** button = frame the whole chart
- click a function's **▸** to collapse its body
- **Export PNG** saves the diagram
