import { z } from 'zod';

export const REPORT_FORMATS = ['json', 'html', 'pdf'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export const REPORT_STATUSES = ['pending', 'generated', 'failed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const ReportFormatSchema = z.enum(REPORT_FORMATS);
export const ReportStatusSchema = z.enum(REPORT_STATUSES);

export interface ReportDTO {
  id: string;
  scanRunId: string;
  title: string;
  format: ReportFormat;
  status: ReportStatus;
  summary: Record<string, unknown> | null;
  storagePath: string | null;
  createdAt: string;
  updatedAt: string;
}

export const ReportDTOSchema = z.object({
  id: z.string().uuid('Invalid report ID format'),
  scanRunId: z.string().uuid('Invalid scan run ID format'),
  title: z.string().min(1).max(255),
  format: ReportFormatSchema,
  status: ReportStatusSchema,
  summary: z.record(z.string(), z.unknown()).nullable(),
  storagePath: z.string().max(2048).nullable(),
  createdAt: z.string().datetime({ message: 'Invalid UTC ISO datetime' }),
  updatedAt: z.string().datetime({ message: 'Invalid UTC ISO datetime' }),
});

export const CreateReportRequestSchema = z.object({
  scanRunId: z.string().uuid('Invalid scan run ID format'),
  title: z.string().trim().min(1).max(255),
  format: ReportFormatSchema,
  summary: z.record(z.string(), z.unknown()).optional().nullable(),
  storagePath: z.string().trim().max(2048).optional().nullable(),
});

export type CreateReportRequest = z.input<typeof CreateReportRequestSchema>;
export type CreateReportOutput = z.output<typeof CreateReportRequestSchema>;

export const GetReportRequestSchema = z.object({
  id: z.string().uuid('Invalid report ID format'),
});

export type GetReportRequest = z.input<typeof GetReportRequestSchema>;

export const ListReportsRequestSchema = z.object({
  scanRunId: z.string().uuid('Invalid scan run ID format').optional(),
  siteId: z.string().uuid('Invalid site ID format').optional(),
  status: ReportStatusSchema.optional(),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export type ListReportsRequest = z.input<typeof ListReportsRequestSchema>;
export type ListReportsOutput = z.output<typeof ListReportsRequestSchema>;

export const ReportListResponseDTOSchema = z.object({
  items: z.array(ReportDTOSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
});

export type ReportListResponseDTO = z.infer<typeof ReportListResponseDTOSchema>;

export const DeleteReportRequestSchema = z.object({
  id: z.string().uuid('Invalid report ID format'),
});

export type DeleteReportRequest = z.input<typeof DeleteReportRequestSchema>;

export const DeleteReportResponseDTOSchema = z.object({
  success: z.boolean(),
  id: z.string().uuid('Invalid report ID format'),
  fileDeleted: z.boolean().optional(),
});

export type DeleteReportResponseDTO = z.infer<typeof DeleteReportResponseDTOSchema>;

export const GetReportContentRequestSchema = z.object({
  id: z.string().uuid('Invalid report ID format'),
});

export type GetReportContentRequest = z.input<typeof GetReportContentRequestSchema>;

export const ReportContentDTOSchema = z.object({
  id: z.string().uuid('Invalid report ID format'),
  format: ReportFormatSchema,
  content: z.string(),
  storagePath: z.string().nullable(),
});

export type ReportContentDTO = z.infer<typeof ReportContentDTOSchema>;

// Aliases
export type CreateReportDTO = CreateReportRequest;
export type GetReportDTO = GetReportRequest;
export type ListReportsQueryDTO = ListReportsRequest;
export type DeleteReportDTO = DeleteReportRequest;
export type GetReportContentDTO = GetReportContentRequest;
