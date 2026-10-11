function emitMetric(name, value, unit = 'Count') {
  const metricPayload = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: 'AirWindow/Alerts',
          Dimensions: [['Environment']],
          Metrics: [{ Name: name, Unit: unit }]
        }
      ]
    },
    Environment: 'Production',
    [name]: value
  };
  console.log(JSON.stringify(metricPayload));
}

module.exports = { emitMetric };
