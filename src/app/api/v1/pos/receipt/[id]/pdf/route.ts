import { handler } from '@/server/http/api';
import { buildReceiptPdf, loadReceiptData } from '@/server/services/pdf.service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/v1/pos/receipt/:id/pdf — unduh struk thermal 80mm dalam format PDF.
 * Header Content-Disposition memaksa browser mengunduh (bukan menampilkan inline).
 */
export const GET = handler(async (_req: Request, { params }: { params: { id: string } }) => {
  const data = loadReceiptData(params.id);
  const pdf = await buildReceiptPdf(data);

  const filename = `struk-${data.orderNo}.pdf`.replace(/[^a-zA-Z0-9-.]/g, '_');

  return new Response(pdf as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(pdf.length),
      'Cache-Control': 'no-store',
    },
  });
});