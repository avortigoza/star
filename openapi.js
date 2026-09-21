// OpenAPI 3.0 spec for STAR's public, stable /api/v1 - served interactively
// via Swagger UI at /api/v1/docs (see server.js), and as raw JSON at
// /api/v1/openapi.json for anyone who wants to generate a client from it.
//
// Kept as a hand-written plain object rather than JSDoc-comment generation
// (swagger-jsdoc) - this API is small (6 endpoints) and changes rarely, so
// a single source-of-truth file next to server.js's actual route
// definitions is easier to keep in sync than scattered comment blocks.

const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'STAR Storage API',
    version: 'v1',
    description:
      'Read-only API for STAR (Storage Tracking & Audit Reporting) - usage totals, ' +
      'per-file/folder storage rows, and generated Excel reports for the IBM and FS5K ' +
      'storage volumes. Every endpoint here is GET-only and considered a stable contract; ' +
      'other apps can build against it without tracking internal STAR changes.',
  },
  servers: [{ url: '/api/v1' }],
  tags: [
    { name: 'Usage', description: 'Storage capacity and usage totals' },
    { name: 'Rows', description: 'Per-file/folder storage breakdown' },
    { name: 'Reports', description: 'Generated monthly and manual Excel reports' },
  ],
  paths: {
    '/': {
      get: {
        summary: 'API index',
        description: 'Lists every available endpoint under /api/v1.',
        responses: {
          200: {
            description: 'Endpoint index',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', example: 'STAR Storage API' },
                    version: { type: 'string', example: 'v1' },
                    endpoints: { type: 'object', additionalProperties: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/usage': {
      get: {
        tags: ['Usage'],
        summary: 'IBM/FS5K usage summary',
        description: 'TB used, capacity, and percent full for both storage volumes.',
        responses: {
          200: {
            description: 'Usage summary for both volumes',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UsageSummary' },
                example: {
                  ibm: { usedTB: 572, capacityTB: 660, percentFull: 86.7, updatedAt: '2026-09-21T08:00:00.000Z' },
                  comp: { usedTB: 417, capacityTB: 440, percentFull: 94.8, updatedAt: '2026-09-21T08:00:00.000Z' },
                },
              },
            },
          },
          500: { description: 'Could not read usage data', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/rows': {
      get: {
        tags: ['Rows'],
        summary: 'All storage rows (both volumes)',
        description: "Per-file/folder storage rows for both IBM and FS5K ('comp' internally) in one call.",
        responses: {
          200: {
            description: 'Rows for both volumes',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ibm: { $ref: '#/components/schemas/RowsForSide' },
                    comp: { $ref: '#/components/schemas/RowsForSide' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/rows/{side}': {
      get: {
        tags: ['Rows'],
        summary: 'Storage rows for one volume',
        parameters: [
          {
            name: 'side',
            in: 'path',
            required: true,
            description: "Which volume - 'ibm' or 'comp' (comp = the FS5K volume; kept as 'comp' internally for backward compatibility with existing stored data). Case-insensitive.",
            schema: { type: 'string', enum: ['ibm', 'comp'] },
          },
        ],
        responses: {
          200: {
            description: 'Rows for the requested volume',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/RowsForSide' },
                    { type: 'object', properties: { side: { type: 'string', example: 'IBM' } } },
                  ],
                },
              },
            },
          },
          400: { description: "side was not 'ibm' or 'comp'", content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/reports': {
      get: {
        tags: ['Reports'],
        summary: 'List past reports',
        description: 'Every generated Excel report - automated monthly runs and manual downloads, both included and distinguished by "source".',
        responses: {
          200: {
            description: 'Report list, newest first',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/ReportEntry' } },
              },
            },
          },
          500: { description: 'Could not list reports', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/reports/{filename}/download': {
      get: {
        tags: ['Reports'],
        summary: 'Download one report file',
        parameters: [
          {
            name: 'filename',
            in: 'path',
            required: true,
            description: 'Exact filename as returned by GET /reports (e.g. star_monthly_report_2026-08-31_1000.xls).',
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'The report file',
            content: { 'application/vnd.ms-excel': { schema: { type: 'string', format: 'binary' } } },
          },
          400: { description: 'Invalid filename', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          404: { description: 'Report not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
  },
  components: {
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
      },
      UsageSummary: {
        type: 'object',
        properties: {
          ibm: { $ref: '#/components/schemas/VolumeUsage' },
          comp: { $ref: '#/components/schemas/VolumeUsage' },
        },
      },
      VolumeUsage: {
        type: 'object',
        properties: {
          usedTB: { type: 'number', example: 572 },
          capacityTB: { type: 'number', example: 660 },
          percentFull: { type: 'number', example: 86.7 },
          updatedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      StorageRow: {
        type: 'object',
        properties: {
          location: { type: 'string', example: '/Volumes/snibmprod/media' },
          size_tb: { type: 'number', example: 515.246 },
          content: { type: 'string', nullable: true, example: 'System Files' },
        },
      },
      RowsForSide: {
        type: 'object',
        properties: {
          rows: { type: 'array', items: { $ref: '#/components/schemas/StorageRow' } },
          updatedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      ReportEntry: {
        type: 'object',
        properties: {
          filename: { type: 'string', example: 'star_monthly_report_2026-08-31_1000.xls' },
          date: { type: 'string', example: '2026-08-31' },
          time: { type: 'string', example: '10:00' },
          sizeBytes: { type: 'integer', example: 45210 },
          generatedAt: { type: 'string', format: 'date-time' },
          source: { type: 'string', enum: ['automated', 'manual'] },
          by: { type: 'string', nullable: true, description: 'Username, only present when source is "manual" and available.' },
          downloadUrl: { type: 'string', example: '/api/v1/reports/star_monthly_report_2026-08-31_1000.xls/download' },
        },
      },
    },
  },
};

module.exports = openApiSpec;
