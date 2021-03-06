var tape = require('tape');
var queue = require('queue-async');
var crypto = require('crypto');
var kinesalite = require('kinesalite')({
  ssl: false,
  createStreamMs: 0,
  deleteStreamMs: 0
});

var AWS = require('aws-sdk');
var kinesis = new AWS.Kinesis({
  accessKeyId: 'fake',
  secretAccessKey: 'fake',
  endpoint: 'http://localhost:7654',
  region: 'fake'
});

var testStreamName = 'test-stream';

var Readable = require('..')({
  name: testStreamName,
  region: 'fake',
  accessKeyId: 'fake',
  secretAccessKey: 'fake',
  endpoint: 'http://localhost:7654'
});

function test(name, callback) {
  tape('start kinesalite', function(assert) {
    queue(1)
      .defer(kinesalite.listen.bind(kinesalite), 7654)
      .defer(kinesis.createStream.bind(kinesis), {
        StreamName: testStreamName,
        ShardCount: 1
      })
      .await(function(err) {
        if (err) throw err;
        assert.end();
      });
  });

  tape(name, callback);

  tape('stop kinesalite', function(assert) {
    queue(1)
      .defer(kinesis.deleteStream.bind(kinesis), {
        StreamName: testStreamName
      })
      .defer(kinesalite.close.bind(kinesalite))
      .await(function(err) {
        if (err) throw err;
        assert.end();
      });
  });
}

test('reads records that already exist', function(assert) {
  var records = [];
  for (var i = 0; i < 20; i++) records.push({
    Data: crypto.randomBytes(10),
    PartitionKey: 'key'
  });

  function readRecords() {
    var readable = new Readable();
    var count = 0;

    readable
      .on('data', function(recordSet) {
        assert.equal(recordSet.length, 1, 'default limit of 1');
        var record = recordSet[0];
        var expected = records[count].Data.toString('hex');
        assert.equal(record.Data.toString('hex'), expected, 'anticipated data');
        count += recordSet.length;
        if (count > records.length) assert.fail('should not read extra records');
        if (count === records.length) readable.close();
      })
      .on('end', function() {
        assert.end();
      })
      .on('error', function(err) {
        assert.ifError(err, 'should not error');
      });
  }

  kinesis.putRecords({
    StreamName: testStreamName,
    Records: records
  }, function(err) {
    if (err) throw err;
    readRecords();
  });
});

test('reads records that are incoming', function(assert) {
  var records = [];
  for (var i = 0; i < 20; i++) records.push({
    Data: crypto.randomBytes(10),
    PartitionKey: 'key'
  });

  var readable = new Readable();
  var count = 0;

  readable.on('data', function(recordSet) {
    assert.equal(recordSet.length, 1, 'default limit of 1');
    var record = recordSet[0];
    var expected = records[count].Data.toString('hex');
    assert.equal(record.Data.toString('hex'), expected, 'anticipated data');
    count += recordSet.length;
    if (count > records.length) assert.fail('Too many records received');
    if (count === records.length) readable.close();
  })
  .on('end', function() {
    assert.end();
  })
  .on('error', function(err) {
    assert.ifError(err, 'should not error');
  });

  kinesis.putRecords({
    StreamName: testStreamName,
    Records: records
  }, function(err) {
    if (err) throw err;
  });
});

test('reads latest records', function(assert) {
  var initialRecords = [];
  var subsequentRecords = [];
  for (var i = 0; i < 20; i++) {
    initialRecords.push({
      Data: crypto.randomBytes(10),
      PartitionKey: 'key'
    });
    subsequentRecords.push({
      Data: crypto.randomBytes(10),
      PartitionKey: 'key'
    });
  }

  function readRecords() {
    var readable = new Readable({ latest: true });
    var count = 0;

    readable
      .on('data', function(recordSet) {
        assert.equal(recordSet.length, 1, 'default limit of 1');
        var record = recordSet[0];
        var expected = subsequentRecords[count].Data.toString('hex');
        assert.equal(record.Data.toString('hex'), expected, 'anticipated data');
        count += recordSet.length;
        if (count > subsequentRecords.length) assert.fail('should not read extra records');
        if (count === subsequentRecords.length) readable.close();
      })
      .on('end', function() {
        assert.end();
      })
      .on('error', function(err) {
        assert.ifError(err, 'should not error');
      });

    setTimeout(function() {
      kinesis.putRecords({
        StreamName: testStreamName,
        Records: subsequentRecords
      }, function(err) {
        if (err) throw err;
      });
    }, 500);
  }

  kinesis.putRecords({
    StreamName: testStreamName,
    Records: initialRecords
  }, function(err) {
    if (err) throw err;
    readRecords();
  });
});

test('emits checkpoints', function(assert) {
  var records = [];
  for (var i = 0; i < 20; i++) records.push({
    Data: crypto.randomBytes(10),
    PartitionKey: 'key'
  });

  var count = 0;
  var readable = new Readable();
  readable
    .on('data', function(recordSet) {
      count += recordSet.length;
      if (count > records.length) assert.fail('should not read extra records');
      if (count === records.length) readable.close();
    })
    .on('checkpoint', function(sequenceNum) {
      assert.ok(sequenceNum, 'emits sequence number to checkpoint event');
    })
    .on('end', function() {
      assert.end();
    })
    .on('error', function(err) {
      assert.ifError(err, 'should not error');
    });

  kinesis.putRecords({
    StreamName: testStreamName,
    Records: records
  }, function(err) {
    if (err) throw err;
  });
});

test('getrecords limits', function(assert) {
  var records = [];
  for (var i = 0; i < 20; i++) records.push({
    Data: crypto.randomBytes(10),
    PartitionKey: 'key'
  });

  function readRecords() {
    assert.plan(3);
    var readable = new Readable({ limit: 10 });
    var count = 0;

    readable
      .on('data', function(recordSet) {
        count += recordSet.length;
        if (count > records.length) assert.fail('should not read extra records');
        if (count === records.length) readable.close();
      })
      .on('checkpoint', function() {
        assert.pass('checkpointed');
      })
      .on('end', function() {
        assert.pass('ended');
      })
      .on('error', function(err) {
        assert.ifError(err, 'should not error');
      });
  }

  kinesis.putRecords({
    StreamName: testStreamName,
    Records: records
  }, function(err) {
    if (err) throw err;
    readRecords();
  });
});

test('reads after checkpoint', function(assert) {
  var records = [];
  for (var i = 0; i < 20; i++) records.push({
    Data: crypto.randomBytes(10),
    PartitionKey: 'key'
  });

  function readRecords(startAfter) {
    var readable = new Readable({ lastCheckpoint: startAfter });
    var count = 10; // should start at the 10th record and read 10 more

    readable
      .on('data', function(recordSet) {
        assert.equal(recordSet.length, 1, 'default limit of 1');
        var record = recordSet[0];
        var expected = records[count].Data.toString('hex');
        assert.equal(record.Data.toString('hex'), expected, 'anticipated data');
        count += recordSet.length;
        if (count > records.length) assert.fail('should not read extra records');
        if (count === records.length) readable.close();
      })
      .on('end', function() {
        assert.end();
      })
      .on('error', function(err) {
        assert.ifError(err, 'should not error');
      });
  }

  kinesis.putRecords({
    StreamName: testStreamName,
    Records: records
  }, function(err, resp) {
    if (err) throw err;
    readRecords(resp.Records[9].SequenceNumber);
  });
});
