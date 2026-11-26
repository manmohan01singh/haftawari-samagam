-- Haftawari Samagam — OPTIONAL one-time admin seed (NOT a migration).
-- Run this ONCE in the Supabase Dashboard SQL Editor (project owner /
-- admin context) to publish the first verified archive recording.
-- The app cannot insert it: RLS makes `videos` writes admin-only, and
-- an anonymous insert with the publishable key is correctly rejected
-- (verified 2026-11-26: Postgres 42501, HTTP 401).
--
-- Video verified against the YouTube Data API v3 on 2026-11-26:
-- "Kal Taaran Gur Nanak Aaya (30/11/20)" — the 2020 Prakash Purab
-- Haftawari, Bhai Gursharan Singh Ji's official channel, duration
-- PT3H35S (3:00:35), published 2020-11-30.

insert into public.videos (
  youtube_video_id, title, description, thumbnail_url,
  duration_seconds, publish_state, is_featured, published_at
) values (
  'G0enZ06AnF0',
  'Kal Taaran Gur Nanak Aaya (30/11/20) | Bhai Gursharan Singh Ji (Ludhiana Wale) | Katha Kirtan | HD',
  'Album : Kal Taaran Gur Nanak Aaya  ( ਕਲਿ ਤਾਰਣਿ ਗੁਰੁ ਨਾਨਕੁ ਆਇਆ ॥ )
Artist:  : Bhai Gursharan Singh Ji (Ludhiana Wale) , Bhai Manjot Singh Ji (Ludhiana Wale) , Bibi Rupinder Kaur Ji (Istri Wing, Ludhiana) 
BHAI GURSHARAN SINGH JI OFFICIAL SOCIAL LINKS :

● TO JOIN WHATSAPP GROUP :
   Type your name and city and send on this number...
    +919501030672
   +919316313133

● YouTube Channel (Official) :
   https://www.youtube.com/channel/UCu7xpk9fOQRs4AvYEOakBfg

● Facebook Page (Official) : 
   https://www.facebook.com/bhaigursharansinghji/

● Instagram Account(Official) :
   https://instagram.com/bhaigursharansinghji?igshid=178mttn1hcopm

● Android App :
   https://play.google.com/store/apps/details?id=centra.com.bhaigursharansingh

● Twitter Account (Official) :
    https://twitter.com/BhaiLudhiana?s=09

● Website :
    www.bhaigursharansinghji.com

Original Copyright 2021 Bhai Gursharan Singh Ji Ludhiana Wale

FOR DONATION BANK ACCOUNT DETAILS :
ICICI Bank (ONLY FOR INDIA)
A/C Name : Bhai Daya Singh Ji (Nishkam) Satsang Sabha
A/C No. : 064201000844
IFSC Code :ICIC0000642

Address : 379-E, Shaheed Bhagat Singh Nagar, Pakhowal Road, Ludhiana, Punjab.
Pincode:- 141001

AT THE TIME OF DEPOSITING SEWA IN THE BANK PLEASE INTIMATE YOUR NAME AND ADDRESS AT THE FOLLOWING MOBILE NUMBERS SO THAT THE SEWA RECEIPT CAN BE SENT TO YOU.
+9184279-09300, +9182838-47722

By the grace of Sri Guru Granth Sahib Ji Bhai Gursharan Singh Ji thought of opening charitable institutions for the service of mankind. The charitable hospitals were very much needed because the common man was suffering very badly due to costly treatments given by the hospitals. Bhai Gursharan Singh Ji with the support of Saadh Sangat opened three charitable hospitals in various areas of Ludhiana, which provide best medical treatments affordable to the common man. Also, Bhai Gursharan Singh Ji has opened a Computer Academy equipped with best equipments to provide best and modern computer education and Spoken English courses which are very costly and deficient in the market, to the aspiring youngsters and grownups. This job oriented education will help people in getting employment also. To impart Gurbani Kirtan education, Bhai Gursharan Singh Ji has also opened a Gurmat Sangeet Academy which gives education of Harmonium, Tabla, and other musical instruments in Classical Ragas. All these religious and charitable activities are going on by the grace of Sri Guru Granth Sahib Ji, blessings of Bhai Guriqbal Singh Ji (Gurudwara Bibi Kaulan Ji, Sri Amritsar Sahib) and support of Saadh Sangat Ji.

#BGSJ #bhaigursharansinghji #waheguru  #simransadhna #wmk #gurbani #naamsimran #katha #kirtan #motivationalquotes #anmolbachan',
  'https://i.ytimg.com/vi/G0enZ06AnF0/maxresdefault.jpg',
  10835,
  'published',
  true,
  '2020-11-30T14:22:23Z'
)
on conflict (youtube_video_id) do nothing;
