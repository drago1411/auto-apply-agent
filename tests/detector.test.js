import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAtsPlatform } from '../ats-engine/detector.js';
import { BaseAdapter } from '../ats-engine/adapters/baseAdapter.js';

test('ATS Detector: Identifies known platforms accurately', () => {
  assert.equal(detectAtsPlatform('https://boards.greenhouse.io/figma/jobs/123'), 'greenhouse');
  assert.equal(detectAtsPlatform('https://jobs.lever.co/netflix/456'), 'lever');
  assert.equal(detectAtsPlatform('https://target.myworkdayjobs.com/targetcareers/job/789'), 'workday');
  assert.equal(detectAtsPlatform('https://careers.smartrecruiters.com/Square/101'), 'smartrecruiters');
  assert.equal(detectAtsPlatform('https://example.com/custom-careers/123'), 'unknown');
});

test('BaseAdapter: Resolves screening answers correctly from bank', () => {
  const mockProfile = {
    screening_answers: [
      { pattern: 'authorized to work', value: 'Yes', type: 'boolean' },
      { pattern: 'require.*sponsorship', value: 'No', type: 'boolean' },
      { pattern: 'years of.*experience.*software', value: '5', type: 'number' },
      { pattern: 'salary expectation', value: '145000', type: 'text' }
    ]
  };

  const adapter = new BaseAdapter(null, mockProfile);

  const q1 = adapter.resolveAnswer('Are you legally authorized to work in the United States?');
  assert.equal(q1.found, true);
  assert.equal(q1.value, 'Yes');

  const q2 = adapter.resolveAnswer('Will you now or in the future require visa sponsorship?');
  assert.equal(q2.found, true);
  assert.equal(q2.value, 'No');

  const q3 = adapter.resolveAnswer('How many years of experience in software development do you have?');
  assert.equal(q3.found, true);
  assert.equal(q3.value, '5');

  const q4 = adapter.resolveAnswer('Do you speak fluent Klingon?');
  assert.equal(q4.found, false);
});
