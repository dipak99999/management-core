import { initOtel } from "@lumaara/service-auth";
initOtel("projects-service");
// Sentry — env-gated via SENTRY_DSN. No-op when unset.
import { initSentry } from "@lumaara/service-auth";
initSentry("projects-service");

import express from "express";
import { projectRouter } from "./routes/projects";
import { taskRouter } from "./routes/tasks";
import { timesheetRouter } from "./routes/timesheets";
import { milestoneRouter } from "./routes/milestones";
import { taskDependencyRouter } from "./routes/task-dependencies";
import { projectTemplateRouter } from "./routes/project-templates";
import { ganttRouter } from "./routes/gantt";
import { agileRouter } from "./routes/agile";
import { customersReadRouter, employeesReadRouter, itemsReadRouter } from "./routes/masters-read";
import { reportsRouter } from "./routes/reports";
import { issueRouter } from "./routes/issues";
import { requireAuth } from "./middleware/require-auth";
import {
  auditMiddleware,
  corsMiddleware,
  customFieldsReadRouter,
  errorCapture,
  getLogger,
  installCrashHandlers,
  installGracefulShutdown,
  jsonErrorHandler,
  normalizeBody,
  mountBasicOps,
  apiLimiter,
  requestLogger,
  securityHeaders,
  validateEnv,
  workflowEndpoints,
} from "@lumaara/service-auth";

validateEnv({
  required: ["DATABASE_URL", "JWT_SECRET", "MASTER_SECRET_KEY"],
  optional: { PORT: "4006" },
});
installCrashHandlers("projects-service");

const app = express();
app.use(corsMiddleware);
app.use(securityHeaders);
app.use(requestLogger("projects-service"));
app.use(apiLimiter);
app.use(express.json());
app.use(normalizeBody);
app.use(
  auditMiddleware({
    routeMap: {
      "projects": "Project",
      "tasks": "Task",
      "timesheets": "Timesheet",
      "milestones": "Milestone",
      "task-dependencies": "Task",
      "project-templates": "Project",
      "workspaces": "AgileWorkspace",
      "sprints": "Sprint",
      "epics": "Epic",
      "releases": "Release",
      "work-items": "WorkItem",
      "okrs": "Okr",
      "key-results": "Okr",
      "issues": "Issue",
    },
  }),
);

mountBasicOps(app, "projects-service");

app.use("/projects", requireAuth, projectRouter);
app.use("/tasks", requireAuth, taskRouter);
app.use("/timesheets", requireAuth, timesheetRouter);
app.use("/reports", requireAuth, reportsRouter);
// Projects-Plus additions.
app.use("/milestones",         requireAuth, milestoneRouter);
app.use("/task-dependencies",  requireAuth, taskDependencyRouter);
app.use("/project-templates",  requireAuth, projectTemplateRouter);
app.use("/gantt",              requireAuth, ganttRouter);
app.use("/issues",             requireAuth, issueRouter);
// Zoho-Sprints-style agile module — workspaces, sprints, epics, work items, OKRs.
app.use("/agile",              requireAuth, agileRouter);
// Read-through masters for dropdowns.
app.use("/customers", requireAuth, customersReadRouter);
app.use("/employees", requireAuth, employeesReadRouter);
app.use("/items", requireAuth, itemsReadRouter);
app.use("/custom-fields-for", customFieldsReadRouter());
app.use("/workflow-actions", workflowEndpoints());

app.use(errorCapture("projects-service"));
app.use(jsonErrorHandler("projects-service"));

const port = Number(process.env.PORT) || 4006;
const server = app.listen(port, () => getLogger("projects-service").info("service listening", { port }));
installGracefulShutdown(server, "projects-service");
