import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import fs from 'fs/promises';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

(async () => {
    const countries = JSON.parse(await fs.readFile('searates_countries.json', 'utf-8'));

    const browser = await puppeteer.launch({ headless: false, args:['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();

    // Login process
    await page.goto('https://www.searates.com/auth/sign-in', {
        timeout: 60000,
        waitUntil: 'domcontentloaded'
    });

    await page.waitForSelector('input#login');
    // await page.type('input#login', '281103yashpatil@gmail.com');
    await page.type('input#login', 'vaibhav@techonsy.com');
    // await page.type('input#password', 'Yash@123');
    await page.type('input#password', 'Searates@12345');
    await page.waitForSelector('button.L6xZMB.yo9FdR');
    const optionalButton = await page.$('button.L6xZMB.yo9FdR');
    while (optionalButton) {
        const list = await page.$('li.nav-header');
        if (list) {
            console.log("list present");
            break;
        } else {
            await new Promise(resolve => setTimeout(resolve, 6000));
            await page.click('button.L6xZMB.yo9FdR');
            await new Promise(resolve => setTimeout(resolve, 6000));
        }
    }

    await page.waitForSelector('li.nav-header');
    await page.goto('https://www.searates.com/user/logistics-explorer/', { waitUntil: 'domcontentloaded' });
    await new Promise(resolve => setTimeout(resolve, 6000));

    const shadowHost = await page.waitForSelector('#shadow-wrapper-le');
    const shadowRoot = await shadowHost.evaluateHandle((element) => element.shadowRoot);

    const inputFrom = await shadowRoot.$('input#FROM');
    await inputFrom.type('India');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const buttons = await shadowRoot.$$('button.ZMP8yd');
    for (let button of buttons) {
        const text = await button.evaluate(el => el.innerText);
        if (text.includes('India')) {
            await button.click();
            break;
        }
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
    const buttonsAfterClick = await shadowRoot.$$('button.ZMP8yd');
    for (let button of buttonsAfterClick) {
        const text = await button.evaluate(el => el.innerText);
        if (text.includes('Mundra')) {
            await button.click();
            console.log("Clicked Mundra");
            break;
        }
    }

    for (let rcountry of countries) {
        const country = rcountry.split(',')[1]?.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
        console.log(`🌍 Country: ${country}`);

        const to = await shadowRoot.$('input#TO');
        await to.click({ clickCount: 3 });
        await to.press('Backspace');
        await to.type(country);
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Click the country name in the dropdown
        const btn = await shadowRoot.$$('button.ZMP8yd');
        let clicked = false;
        for (let button of btn) {
            const text = await button.evaluate(el => el.innerText);
            if (text.includes(country)) {
                await button.click();
                clicked = true;
                break;
            }
        }
        if (!clicked) {
            console.log(`❌ Country not found in options: ${country}`);
            continue;
        }

        await new Promise(resolve => setTimeout(resolve, 3000));

        // Get list of port names for this country
        const afterclick = await shadowRoot.$$('button.ZMP8yd');
        let portNames = [];

        for (let button of afterclick) {
            const portName = await button.evaluate(el => {
                const nameDiv = el.querySelector('.qdzjfH');
                return nameDiv ? nameDiv.textContent.trim() : null;
            });

            const label = await button.evaluate(el => el.innerText);

            if (label.includes('Port') && !label.includes('Airport') && portName) {
                portNames.push(portName);
            }
        }

        if (portNames.length === 0) {
            console.log(`⚠️ No valid ports found for ${country}`);
            continue;
        }

        console.log(`📦 Ports in ${country}:`, portNames);

        // Process each port
        for (let port of portNames) {
            // Retype the destination again
            await to.click({ clickCount: 3 });
            await to.press('Backspace');
            await to.type(country);
            await new Promise(resolve => setTimeout(resolve, 3000));

            const btns = await shadowRoot.$$('button.ZMP8yd');
            for (let b of btns) {
                const text = await b.evaluate(el => el.innerText);
                if (text.includes(country)) {
                    await b.click();
                    break;
                }
            }

            await new Promise(resolve => setTimeout(resolve, 3000));

            const portButtons = await shadowRoot.$$('button.ZMP8yd');
            let portClicked = false;

            for (let button of portButtons) {
                const portName = await button.evaluate(el => {
                    const div = el.querySelector('.qdzjfH');
                    return div ? div.textContent.trim() : null;
                });

                if (portName === port) {
                    await button.click();
                    portClicked = true;
                    break;
                }
            }

            if (!portClicked) {
                console.log(`⚠️ Port ${port} not clickable`);
                continue;
            }

            const searchButton = await shadowRoot.$('button.WTsBDL');
            await searchButton.click();

            await new Promise(resolve => setTimeout(resolve, 6000));

            try {
                const priceHandle = await shadowRoot.evaluateHandle((root) =>
                    root.querySelector('.JlMcOA')
                );
                const price = await priceHandle.evaluate(el => el.textContent.trim());
                console.log(`✅ ${country} - ${port}: ${price}`);
                let fullport = `${port}, ${country}`;
                const Validprice = price.replace(/[^\d]/g, '');

                // Save to Supabase
                const { error } = await supabase
                    .from('freight_backup')
                    .upsert(
                        {
                            port: fullport,
                            freight: Validprice,
                            created_at: new Date().toISOString()
                        },
                        { 
                            onConflict: 'port',
                            ignoreDuplicates: false
                        }
                    );

                if (error) {
                    console.error(`Error saving port ${port}:`, error.message);
                }

            } catch (e) {
                console.log(`❌ ${country} - ${port}: No price found or search failed.`);

                // Save null value if there was an error
                const { error } = await supabase
                    .from('freight_backup')
                    .upsert(
                        {
                            port: port,
                            freight: null,
                            created_at: new Date().toISOString()
                        },
                        { 
                            onConflict: 'port',
                            ignoreDuplicates: false
                        }
                    );

                if (error) {
                    console.error(`Error saving failed port ${port}:`, error.message);
                }
            }

            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    await browser.close();
})();