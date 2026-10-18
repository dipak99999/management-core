import { Icon, type NavGroup } from "./app-shell";

export const MODULE_NAME = "Projects";
export const MODULE_NAV: NavGroup[] = [
  {
    links: [
      { href: "/projects",             label: "Overview",   icon: Icon.home },
      { href: "/projects/projects",           label: "Projects",   icon: Icon.layers },
      { href: "/projects/tasks",              label: "Tasks",      icon: Icon.clipboard },
      { href: "/projects/milestones",         label: "Milestones", icon: Icon.layers },
      { href: "/projects/issues",             label: "Issues",     icon: Icon.clipboard },
      { href: "/projects/timesheets",         label: "Timesheets", icon: Icon.clock },
      { href: "/projects/project-templates",  label: "Templates",  icon: Icon.layers },
      { href: "/projects/sprints",            label: "Sprints",    icon: Icon.layers },
    ],
  },
];
