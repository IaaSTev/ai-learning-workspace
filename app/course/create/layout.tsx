import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create course",
  description: "Upload your course syllabus to get started",
};

export default function CourseCreateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
