/** What you can make, as shown on Home and Create. Light on purpose: no engine imports here. */
import type { Workflow } from "./router";

export type ExampleId = "photo" | "name" | "pattern" | "trace";

export type WorkflowCard = {
  id: Exclude<Workflow, "depth" | "names99">;
  title: string;
  /** one line, what goes in and what comes out */
  does: string;
  /** what the person gets, in CNC terms */
  gives: string;
  img: string;
  imgAlt: string;
  example: ExampleId;
  exampleLabel: string;
};

export const WORKFLOWS: readonly WorkflowCard[] = [
  {
    id: "text",
    title: "Text / Arabic",
    does: "Names, Quran verses, dhikr and the 99 Names, typeset exactly from real fonts.",
    gives: "Plaques and boards with frames and corner flowers",
    img: "/examples/ex-name.webp",
    imgAlt: "A carved name plaque with flower corners",
    example: "name",
    exampleLabel: "Try a name plaque",
  },
  {
    id: "image",
    title: "Image relief",
    does: "A photo or picture of a carving, turned into a 3D relief.",
    gives: "Panels, borders and legs",
    img: "/examples/ex-photo.webp",
    imgAlt: "A flower panel rebuilt in 3D from a photo",
    example: "photo",
    exampleLabel: "Try a carving photo",
  },
  {
    id: "pattern",
    title: "Pattern",
    does: "Islamic star patterns, with a word or name in the centre if you like.",
    gives: "Screens, doors and wall panels",
    img: "/examples/ex-pattern.webp",
    imgAlt: "Allah in the centre of a 12-point star pattern",
    example: "pattern",
    exampleLabel: "Try a star pattern",
  },
  {
    id: "trace",
    title: "Trace logo",
    does: "A sketch or logo turned into clean vector lines.",
    gives: "DXF and SVG for V-carving and profiling",
    img: "/examples/ex-trace.webp",
    imgAlt: "A traced drawing as vector lines",
    example: "trace",
    exampleLabel: "Try a drawing",
  },
];

/** Workspace title for the phone top bar. */
export const WORKFLOW_TITLE: Record<Exclude<Workflow, "depth">, string> = {
  image: "Image relief",
  text: "Text / Arabic",
  names99: "99 Names",
  pattern: "Pattern",
  trace: "Trace logo",
};
