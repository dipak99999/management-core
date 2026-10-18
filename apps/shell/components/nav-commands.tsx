"use client";
import { useRegisterCommand } from "@lumaara/web-ui";
import { useRouter } from "next/navigation";
import { filteredShellNav } from "./shell-nav";

/**
 * Registers every nav link as a palette command so `⌘K` doubles as the
 * app's global navigator. Runs client-side; falls back to the full
 * (unfiltered) nav before plan info is cached in sessionStorage.
 */
export function NavCommands() {
  const router = useRouter();
  const groups = filteredShellNav();
  return (
    <>
      {groups.flatMap((g) =>
        g.links.map((link) => (
          <RegisterNavCmd
            key={`${g.label}:${link.href}`}
            id={`nav:${link.href}`}
            label={link.label}
            group={g.label ?? "Navigation"}
            hint={link.href}
            keywords={[link.href, g.label ?? ""].filter(Boolean)}
            run={() => router.push(link.href)}
          />
        )),
      )}
    </>
  );
}

function RegisterNavCmd(props: {
  id: string;
  label: string;
  group?: string;
  hint?: string;
  keywords?: string[];
  run: () => void;
}) {
  useRegisterCommand(props);
  return null;
}
