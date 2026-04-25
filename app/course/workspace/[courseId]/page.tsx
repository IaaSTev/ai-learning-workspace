import type { Metadata } from "next";
import { memTrace } from "@/lib/mem-trace";
import { CourseWorkspaceView } from "./course-workspace-view";

export const metadata: Metadata = {
  title: "Course workspace",
};

export default async function CourseWorkspacePage() {
  memTrace("course/workspace/[courseId]/page RSC render START");
  try {
    return <CourseWorkspaceView />;
  } finally {
    memTrace("course/workspace/[courseId]/page RSC render END");
  }
}
