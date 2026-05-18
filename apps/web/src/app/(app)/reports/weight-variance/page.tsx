export default function WeightVarianceStubPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Weight Variance</h1>
      <div className="bg-white rounded-lg shadow p-6 text-sm text-gray-600">
        Detail view ships in Phase 11. The API endpoint at{' '}
        <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">
          /v1/reports/weight-variance
        </code>{' '}
        is live and can be called directly.
      </div>
    </div>
  );
}
