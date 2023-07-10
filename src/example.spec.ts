import { test, expect } from '@playwright/test';
import {writeFileSync} from 'fs'
import axios from "axios";
require('dotenv').config();

const getAuthData = () => {
  const code = process.env.ECP_KEY;
  const password = process.env.ECP_PASSWORD;
  const name = 'temp_key.jks';
  const fileContent = atob(code);

  writeFileSync(name, fileContent, {encoding: "binary"});

  return {
     name,
     password,
  }
}

test('find a talons', async ({ page }) => {
  test.setTimeout(120000);

  await page.goto('https://eq.hsc.gov.ua/');

  await page.getByRole('checkbox').check();

  await page.getByRole('link', { name: 'Е-ЗАПИС', exact: true }).click();

  await page.getByRole('link', { name: 'Файловий носій', exact: true }).click();

  await page.locator("#CAsServersSelect").selectOption('АЦСК АТ КБ «ПРИВАТБАНК»');

  const {name: keyFileName, password} = getAuthData();

  await page.setInputFiles("input[type='file']", keyFileName);

  await page.locator('#PKeyPassword').type(password);

  await page.getByText('Продовжити').click();

  await page.getByLabel('Даю згоду на поширення персональних даних').check();

  await page.getByText('Продовжити').click();

  await page.getByRole('button', { name: 'Записатись' }).click();

  await page.goto('https://eq.hsc.gov.ua/site/step_pe');

  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Практичний іспит (транспортний засіб навчального закладу)' }).click();

  await page.getByRole('button', { name: 'Так. Я успішно склав теоретичний іспит в сервісному центрі МВС.' }).click()

  await page.goto('https://eq.hsc.gov.ua/site/step1?value=56');

  const dates = await page.locator('[href="/site/step2"]').all();

  // @ts-ignore
  const dateValues = await Promise.all(dates.map(async date => {
    const text = await date.allInnerTexts();

    const dateValueJSON = await date.getAttribute('data-params');

    const dateValue = JSON.parse(dateValueJSON)['chdate'];

    return {dateValue, text};
  }));

  await expect(dates).toBeDefined();

  console.log('\n💖 💖 💖 💖 💖');

  const results = [];
  const resultsObject = {data: [], offices: new Map()};

  for (const date of dateValues) {
    await page.goto(`https://eq.hsc.gov.ua/site/step2?chdate=${date?.dateValue}&question_id=56&id_es=`);

    await page.waitForTimeout(200);
    // @ts-ignore
    const markers = await page.evaluate(() => window?.markers);
    console.log('\n')
    console.info(date?.text.toString().toUpperCase().replace(/\n/g, ' '));

    const dateObject = {
      date: date?.dateValue,
      text: date?.text.toString().replace(/\n/g, ' '),
      markers: [],
    };

    if(markers && markers.length){
      for (const marker of markers) {
        const {
          offices_n,
          id_region,
          lang,
          long,
          offices_addr,
          offices_name,
          id_offices,
        } = marker;

        resultsObject.offices.set(offices_n, {
          offices_n,
          id_region,
          lang,
          long,
          offices_addr,
          offices_name,
          id_offices,
        });

        if(marker?.cnt) {
          dateObject.markers.push({
            offices_n,
            talons: marker?.cnt,
          })
        }

        // @ts-ignore
        // if(marker?.cnt && marker?.offices_n === '4641') {
        if(marker?.cnt && marker?.offices_n === '8049') {
          const dateText = date?.text.toString().toUpperCase().replace(/\n/g, '');
          results.push(`🚗ТСЦ #: ${marker?.offices_n} Дата: ${dateText} Талончиків: ${marker?.cnt} 🚗`);
          // @ts-ignore
          console.log(`🚗 🚗ТСЦ #: ${marker?.offices_n} Талончиків: ${marker?.cnt}  🚗 🚗 🚗\n`)
        }
      }

      resultsObject.data.push(dateObject);
    }
  }

  if(results && results.length > 0) {
    writeFileSync('results.txt', results.join(' '));
  }

  if(resultsObject) {
    writeFileSync('results.json', JSON.stringify({
      data: resultsObject.data,
      offices: Array.from(resultsObject.offices, ([_name, value]) => value),
    }));

    const response = await axios({
      method: 'post',
      url: `${process.env.WEBHOOK_URL}`,
      data: {
        data: resultsObject.data,
        offices: Array.from(resultsObject.offices, ([_name, value]) => value),
      }
    });

    console.log(response.data)
  }

  console.log('\n')

  console.log('✅ ✅ ✅ ✅ ✅ ✅');

  await page.close();
});

