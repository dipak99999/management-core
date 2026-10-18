import type { DocumentProps } from "@react-pdf/renderer";
import { renderToBuffer } from "@react-pdf/renderer";
import type { ReactElement } from "react";

// Render a @react-pdf/renderer Document to a Buffer. Wrapping is a thin
// convenience so callers don't need to import from @react-pdf/renderer
// directly.
//
// The generic loosening (`ReactElement<any>` at the call boundary) lets us
// accept both a `<Document>` root and a `React.createElement(SomeDocument)`
// wrapper — the underlying react-pdf DocumentProps type is too narrow to
// accept function-component wrappers without a cast at every call site.
export async function renderPdf(
  doc: ReactElement<DocumentProps> | ReactElement,
): Promise<Buffer> {
  return await renderToBuffer(doc as ReactElement<DocumentProps>);
}
