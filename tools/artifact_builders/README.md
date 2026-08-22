# Artifact builders

These files are version-controlled reproducible build sources. They are not temporary Codex working files and must be reviewed with the artifacts they generate.

## Builders

| Script | Output family | Purpose |
|---|---|---|
| `build_arch_reconciliation_v11.py` | `docs/architecture/GEO_OS_Technical_Architecture_Reconciliation_*.docx` | Technical architecture reconciliation baseline |
| `build_g001_governance.py` | `outputs/g0-01/GEO_OS_G0-01_Authority_Change_Control_*.docx` | G0-01 authority, change control, and ADR review pack |
| `build_g001_review_runbook.py` | `outputs/g0-01/GEO_OS_G0-01_Formal_Review_Runbook_*.docx` | Formal G0-01 review procedure and blank closure template |
| `build_scope_matrix.mjs` | `outputs/g0-01/GEO_OS_G0-01_Scope_Matrix_*.xlsx` | Scope, authority, change-control, and Open Decision workbook |
| `build_product_solution_v11.py` | `outputs/product-v*/GEO_OS_产品方案对齐修订版_*.docx` plus SVG/PNG diagrams | Product-alignment baseline and business/technical architecture diagrams |
| `build_business_architecture_v2.py` | `outputs/product-architecture-v*/GEO_OS_业务架构图_模块化持续闭环版_*` | Editorial SVG/PNG business architecture focused on independent modules and the recurring optimization loop |
| `build_detailed_business_architecture_v3.py` | `outputs/product-architecture-detailed-v*/GEO_OS_详细业务架构图_模块逻辑与处理链路_*` | Detailed editorial SVG/PNG business architecture with independent domains, eight-step processing logic, and cross-module semantic layers |

## Non-overwrite rule

Every builder refuses to overwrite an existing artifact. To create a reviewed revision, set `GEO_OS_ARTIFACT_OUTPUT` to a new, explicitly versioned path. Never point it at an existing `APPROVED / FROZEN` or review-candidate file.

The spreadsheet builder writes QA previews under `.build/artifact-previews/` unless `GEO_OS_QA_OUTPUT_DIR` is supplied. `.build/` is ignored and is never part of a formal review package.

The product-alignment builder writes five coordinated artifacts. Set `GEO_OS_PRODUCT_OUTPUT_DIR` to a new versioned directory when preparing a later review candidate; it refuses to replace any existing file in that directory.

## Runtime

- DOCX builders require Python and `python-docx`.
- The XLSX builder requires the Codex workspace Node.js runtime and `@oai/artifact-tool`. Set `GEO_OS_NODE_MODULES` to the workspace dependency `node_modules` directory when the package is not installed under the repository.
- Builders are engineering sources; generated artifacts still require the document/spreadsheet render and inspection workflow before release.

## Example: create a new review revision

PowerShell:

```powershell
$env:GEO_OS_ARTIFACT_OUTPUT = 'D:\code\geo-evolution-project\outputs\g0-01\GEO_OS_G0-01_Formal_Review_Runbook_V1.1.docx'
python .\tools\artifact_builders\build_g001_review_runbook.py
Remove-Item Env:GEO_OS_ARTIFACT_OUTPUT
```

The example creates a new file. It must not be used to overwrite the V1.0 review candidate.

## Gate Closure Record guard

No builder in this directory is authorized to produce a finalized G0-01 Closure Record. A Closure Record may be generated only after all of the following evidence exists:

- all 39 Scope items have confirmed named primary and backup owners;
- all six Open Decisions are closed;
- ADR-001 passes real-conflict validation;
- all formal review comments are disposed;
- SHA-256 is recalculated for every final candidate artifact;
- approver, approval timestamp, and final versions are completely recorded.

Until then, any Closure Record content is a blank template and G0-01 remains `OPEN / PENDING REVIEW`.

## Render terminology

Compatibility-render QA must be recorded separately from the standard LibreOffice render gate. Never label a document `STANDARD LIBREOFFICE RENDER PASSED` unless the standard renderer actually completed and its pages were inspected.
