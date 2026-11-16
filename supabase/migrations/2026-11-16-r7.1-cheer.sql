-- R7.1: Cheer's definition. Safe to run twice.

begin;

update categories set
  definition = 'Celebrating people: noticing what''s good, recognizing progress, enjoying the work together, and recharging for lasting significance.'
  where name = 'Cheer';

commit;
