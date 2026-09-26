export type ChapterId =
  | "boot"
  | "build"
  | "test"
  | "deploy"
  | "protect"
  | "operate"
  | "finale";

export interface Chapter {
  id: ChapterId;
  index: string;
  navLabel: string;
  title: string;
  statement: string;
  start: number;
  end: number;
  align: "left" | "right" | "center";
}

export const chapters: Chapter[] = [
  {
    id: "boot",
    index: "00",
    navLabel: "BOOT",
    title: "WE ENGINEER\nWHAT’S NEXT.",
    statement: "Digital systems, designed as one living infrastructure.",
    start: 0,
    end: 0.07,
    align: "left",
  },
  {
    id: "build",
    index: "01",
    navLabel: "BUILD",
    title: "ENGINEERING IDEAS\nINTO SYSTEMS.",
    statement: "Application engineering that turns intent into resilient products.",
    start: 0.07,
    end: 0.24,
    align: "left",
  },
  {
    id: "test",
    index: "02",
    navLabel: "TEST",
    title: "PROOF BEFORE\nPROMISE.",
    statement: "Every layer verified before it becomes part of the whole.",
    start: 0.24,
    end: 0.39,
    align: "right",
  },
  {
    id: "deploy",
    index: "03",
    navLabel: "DEPLOY",
    title: "FROM COMMIT\nTO CLOUD.",
    statement: "Cloud and DevOps systems built to move without breaking.",
    start: 0.39,
    end: 0.58,
    align: "left",
  },
  {
    id: "protect",
    index: "04",
    navLabel: "PROTECT",
    title: "SECURITY BECOMES\nTHE ENVIRONMENT.",
    statement: "Protection engineered through every surface, service and signal.",
    start: 0.58,
    end: 0.73,
    align: "right",
  },
  {
    id: "operate",
    index: "05",
    navLabel: "OPERATE",
    title: "INTELLIGENCE\nIN MOTION.",
    statement: "AI and data connected to the systems where decisions happen.",
    start: 0.73,
    end: 0.88,
    align: "left",
  },
  {
    id: "finale",
    index: "06",
    navLabel: "INITIATE",
    title: "PUT YOUR NEXT SYSTEM\nIN MOTION.",
    statement: "e Gain Technologies Ltd.",
    start: 0.88,
    end: 1,
    align: "center",
  },
];

export function chapterAtProgress(progress: number): Chapter {
  return chapters.find((chapter) => progress >= chapter.start && progress < chapter.end) ?? chapters.at(-1)!;
}
