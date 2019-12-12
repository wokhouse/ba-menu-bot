const fetch = require('node-fetch');
const to = require('await-to-js').default;
const moment = require('moment');

// commons is cafe ID 224
// set up URL for getting today's menu
const cafeID = 224;
const url = new URL('https://legacy.cafebonappetit.com/api/2/menus');
url.search = `cafe=${cafeID}`;

const fetchMenuData = async () => {
  // fetch menu data
  const [err, resRaw] = await to(fetch(url));
  if (err) return (err.message);
  // parse into JSON
  const [parsingErr, data] = await to(resRaw.json());
  if (parsingErr) return (parsingErr.message);
  return data;
};

// wrap in function so we can use async/await
const main = async () => {
  const data = await fetchMenuData();
  // menu is stored in parts of the day
  const dayParts = data.days[0].cafes[cafeID].dayparts[0];
  // parse start and end times
  const parsedParts = dayParts.map((p, i) => {
    const start = moment(p.starttime, 'HH:mm');
    const end = moment(p.endtime, 'HH:mm');
    return { start, end, index: i };
  });
  // check to see if we are 1 hour away from a meal
  const closeToMeal = parsedParts.map((p) => {
    const now = moment('11:00', 'HH:mm');
    const { start } = p;
    // past 1 hour before meal starts
    const withinAnHour = start.subtract(1, 'hour').isBefore(now);
    // meal hasnt started yet
    const hasntStartedYet = start.add(1, 'hour').isAfter(now);
    if (withinAnHour && hasntStartedYet) return true;
    return false;
  });
  const nextNearMealIndex = closeToMeal.indexOf(true);
  // if there's no meal in < 1hr, don't do anything
  if (nextNearMealIndex === -1) return false;
  // index of which meal is in an hour w/in dayParts array
  const nextNearMeal = dayParts[nextNearMealIndex];
  // go through each station and get tier 1 items
  const nextMealWithItems = nextNearMeal.stations.map((m) => {
    const { items, label: stationLabel } = m;
    // get item data using the keys included in the station items
    const thisStationItems = items.map((i) => data.items[i]);
    // filter out tier 1 items (the big ones, exclude things like sugar and pickles)
    const tier1Items = thisStationItems.filter((i) => {
      // if item does not contain a tier key, don't include in list
      if ('tier' in i === false) return false;
      // if item has 1 as tier, include in list
      if (i.tier === 1) return true;
      // if item has something other than 1 in tier, don't include in list
      return false;
    });
    // just get item name, description and labels (eg vegan, veg)
    const itemData = tier1Items.map(
      ({
        label,
        description,
        cor_icon, // eslint-disable-line camelcase
      }) => {
        // parse out veg, vegan, gluten free
        const noticeNumbers = Object.keys(cor_icon).filter(
          (i) => Array.from([1, 4, 9]).indexOf(parseInt(i, 10)) > -1,
        );
        // convert numbers to labels
        const notices = noticeNumbers.map((n) => {
          switch (n) {
            case ('1'): { return 'vegetarian'; }
            case ('4'): { return 'vegan'; }
            case ('9'): { return 'gluten-free'; }
            default: { return null; }
          }
        });
        return ({
          label,
          description,
          notices,
        });
      },
    );
    const stationWithItems = { label: stationLabel, items: itemData };
    return stationWithItems;
  });
  // filter out stations that aren't serving any items (ie stations from other meals)
  const nextMeal = nextMealWithItems.filter((s) => s.items.length > 0);
  // get the name of the meal
  const nextMealName = nextNearMeal.label;
  // convert each station into a string
  const stationStrings = nextMeal.map((s) => {
    const stationName = s.label;
    const items = s.items.map(({ label, notices }) => `${label} ${notices.length ? `(${notices.join(' ')})` : ''}`);
    const stationString = `== ${stationName} ==\n${items.join('\n')}`;
    return stationString;
  });
  // make array of tweet texts
  const tweets = [`Reed College Commons ${nextMealName} ${moment().format('MMM Do YYYY')}`].concat(stationStrings);
  tweets.map((t) => console.log(t, '\n'));
  return true;
};

main();
