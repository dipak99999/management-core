import { redirect } from "next/navigation";

// /projects is the module landing — users want the project list, not a
// hub card-picker (sidebar already lists every sub-section). Jump
// straight to the list.
export default function ProjectsHomePage(): never {
  // basePath "/projects" is prepended automatically → final URL is /projects/projects
  redirect("/projects");
}
