import { test, expect } from '@playwright/test';
import {writeFileSync} from 'fs'
import axios from "axios";
import {Telegraf} from "telegraf";
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

enum IssueType  {
  'practice_on_school_car' = '56',
  'practice_on_service_center_car' = '55',
  'theory_exam' = '52',
}
type Marker = {
  offices_n: string;
  talons: number;
  issueType: string;
};

type DateObject = {
  date: string;
  text: string;
  markers: Array<Marker>
}

type OfficesMap = {
  lang: string;
  long: string;
  offices_addr: string;
  offices_name: string;
  offices_n: string;
  id_offices?: string;
}


test('find a talons', async ({ page }) => {
  const issuesToParse = JSON.parse(process.env.ISSUES || "[]");

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

  const results: Array<string> = [];
    const resultsObject: {
      data: DateObject[],
      offices: Map<string,OfficesMap>,
    } = {data: [], offices: new Map<string, OfficesMap> ()};

  const getTalonsByIssueId = async (issueType: IssueType) => {
    const issueName = Object.keys(IssueType)[Object.values(IssueType).indexOf(issueType)];
    
    if(!issuesToParse.includes(issueName)) {
      return;
    }

    await page.goto(`https://eq.hsc.gov.ua/site/step1?value=${issueType}`);
    const dates = await page.locator('[href="/site/step2"]').all();
    const dateValues = (await Promise.all(dates.map(async date => {
      const text = await date.allInnerTexts();
  
      const dateValueJSON = (await date.getAttribute('data-params')) || '{}';
  
      const dateValue = JSON.parse(dateValueJSON)['chdate'];
  
      return {dateValue, text};
    }))).filter(date => {
      const dateText = date?.text.toString().toUpperCase().replace(/\n/g, '');

      return !dateText?.includes('ПОНЕДІЛОК') && !dateText?.includes('НЕДІЛЯ');
    });

    expect(dates).toBeDefined();
    expect(dateValues).toBeDefined();

    for (const date of dateValues) {
      const dateText = date?.text.toString().toUpperCase().replace(/\n/g, '');

      await page.goto(`https://eq.hsc.gov.ua/site/step2?chdate=${date?.dateValue}&question_id=${issueType}&id_es=`);
      
      // TODO: wait not for timeout, but wait for markers in a map
      // await page.waitForTimeout(200);

      const markers = await page.evaluate('window?.markers');

      const dateObject: {
        date: string;
        text: string;
        markers: Array<Marker>
      } = {
        date: date?.dateValue,
        text: date?.text.toString().replace(/\n/g, ' '),
        markers: [],
      };
    
      if(markers && markers?.length){
        for (const marker of markers) {
          const {
            lang,
            long,
            offices_addr,
            offices_name,
            id_offices,
          } = marker;
            
          const offices_n = offices_name.match(/\d{4}/)?.[0];
  
          resultsObject.offices.set(offices_n, {
            offices_n,
            id_offices,
            lang,
            long,
            offices_addr,
            offices_name,
          });

          const js = `
          new Promise((res) => $.ajax({
            type: 'POST',
            url: '/site/freetimes',
            data: 
            { 
              office_id: ${id_offices},
              date_of_admission: "${date?.dateValue}",
              question_id: ${issueType},
              es_date: undefined,
              es_time: undefined,
            },
          }).done(data => res(data)));
          `;

          const response = await page.evaluate(js);

          // await page.waitForTimeout(100);
          const talons = JSON.parse(response as string)?.rows || [];

          
          if(marker && talons.length > 0) {
            dateObject.markers.push({
              offices_n,
              talons: talons.length || true,
              issueType: issueName,
            });
          }
  
          if(talons.length > 0 && offices_n === '8049') {
            results.push(`\n🚗ТСЦ #: ${offices_n}\nДата: ${dateText}\nТалончиків: ${marker?.cnt || 'X'} 🚗\nПитання: ${issueName}`);
            // @ts-ignore
          
            console.log(`🚗 🚗ТСЦ #: ${offices_n} Талончиків: ${marker?.cnt || 'X'} Питання: ${issueName}  🚗 🚗 🚗\n`)
          }
        }

        results.push(`\nД:${date?.text.toString().toUpperCase().replace(/\n/g, '')} П:${issueName} К-ть:${dateObject.markers.length}\n`)
  
      }

      // // check false-positives days for practice
      // if(dateObject.markers.length < 60 && issueName !== 'theory_exam') {
      //   resultsObject.data.push(dateObject);
      // }

      // // check false-positives days for theory
      // if(dateObject.markers.length < 95 && issueName === 'theory_exam') {
      //   resultsObject.data.push(dateObject);
      // }
    }
  }

  console.log('\n💖 💖 💖 💖 💖');

  const issues = Object.keys(IssueType); // practice_on_school_car, ...
  
  for (const issue of issues) {
    await getTalonsByIssueId(IssueType[issue]);
  }
  

    console.log({resultsObject});
    
  if(results && results.length > 0) {
    const bot = new Telegraf(process.env.TELEGRAM_TOKEN as string);

    await bot.telegram.sendMessage(process.env.TELEGRAM_TO as string, results.join(''))
  }

  // if(resultsObject) {
  //   const response = await axios({
  //     method: 'post',
  //     url: `${process.env.WEBHOOK_URL}`,
  //     data: {
  //       data: resultsObject.data,
  //       offices: Array.from(resultsObject.offices, ([_name, value]) => value),
  //       issues: issuesToParse,
  //     }
  //   });

  //   console.log(response.data)
  // }

  console.log('\n')

  console.log('✅ ✅ ✅ ✅ ✅ ✅');

  await page.close();
});

